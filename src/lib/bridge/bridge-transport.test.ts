import { afterEach, expect, it, vi } from 'vitest'
import { openBridgeTransport, tauriTransport, type BridgeMessage, type TauriIpc, type TransportHandlers } from './bridge-transport'

afterEach(() => vi.unstubAllGlobals())

const flush = () => new Promise((resolve) => setTimeout(resolve))

function recorder() {
  const events: (string | BridgeMessage)[] = []
  const handlers: TransportHandlers = {
    onOpen: () => events.push('open'),
    onClose: () => events.push('close'),
    onMessage: (message) => events.push(message),
  }
  return { events, handlers }
}

/** `@tauri-apps/api/core` as far as the transport uses it: each call is recorded and answered by `respond`. */
function fakeIpc(respond: (command: string) => Promise<unknown> = () => Promise.resolve(null)) {
  const calls: { command: string; args: unknown }[] = []
  const channels: { onmessage: (message: BridgeMessage) => void }[] = []
  const ipc: TauriIpc = {
    invoke(command, args) {
      calls.push({ command, args })
      return respond(command)
    },
    Channel: class {
      onmessage: (message: BridgeMessage) => void = () => undefined
      constructor() { channels.push(this) }
    },
  }
  return { ipc, calls, channels }
}

it('opens with a channel, reports open once the Rust side answered, and passes channel messages on', async () => {
  const { events, handlers } = recorder()
  const { ipc, calls, channels } = fakeIpc()
  const transport = tauriTransport(handlers, async () => ipc)
  expect(transport.isOpen()).toBe(false)
  await flush()
  expect(calls).toEqual([{ command: 'bridge_open', args: { events: channels[0] } }])
  expect(transport.isOpen()).toBe(true)

  const ack: BridgeMessage = { type: 'ack', frameId: 1, count: 1, udpMs: 0.1, bytes: 190 }
  channels[0].onmessage(ack)
  expect(events).toEqual(['open', ack])
})

it('sends the config as JSON arguments and a frame as the raw request body', async () => {
  const { ipc, calls } = fakeIpc()
  const transport = tauriTransport(recorder().handlers, async () => ipc)
  await flush()
  const config = { type: 'config', host: 'wled.local', protocol: 'sacn', universe: 2, oscPort: 9000 } as const
  const frame = new Uint8Array([1, 0, 0, 0, 255, 128, 0])
  transport.sendConfig(config)
  transport.sendFrame(frame)
  expect(calls.slice(1)).toEqual([{ command: 'bridge_config', args: { config } }, { command: 'bridge_frame', args: frame }])
  expect(calls[2].args).toBe(frame)
})

it('is congested while more than two frames wait for the Rust side, and recovers when they are taken', async () => {
  const taken: (() => void)[] = []
  const { ipc } = fakeIpc((command) => (command === 'bridge_frame' ? new Promise<void>((resolve) => taken.push(resolve)) : Promise.resolve(null)))
  const transport = tauriTransport(recorder().handlers, async () => ipc)
  await flush()
  for (let i = 0; i < 2; i++) transport.sendFrame(new Uint8Array(7))
  expect(transport.congested(7)).toBe(false)
  transport.sendFrame(new Uint8Array(7))
  expect(transport.congested(7)).toBe(true)
  taken[0]()
  await flush()
  expect(transport.congested(7)).toBe(false)
})

it('closes once when the open fails, so the client retries as it does after a lost socket', async () => {
  const { events, handlers } = recorder()
  const { ipc } = fakeIpc(() => Promise.reject(new Error('bridge_open not allowed')))
  const transport = tauriTransport(handlers, async () => ipc)
  await flush()
  expect(events).toEqual(['close'])
  expect(transport.isOpen()).toBe(false)
})

it('closes once when a frame is rejected, and sends nothing more', async () => {
  const { events, handlers } = recorder()
  const { ipc, calls } = fakeIpc((command) => (command === 'bridge_frame' ? Promise.reject(new Error('bridge is not open')) : Promise.resolve(null)))
  const transport = tauriTransport(handlers, async () => ipc)
  await flush()
  transport.sendFrame(new Uint8Array(7))
  transport.sendFrame(new Uint8Array(7))
  await flush()
  expect(events).toEqual(['open', 'close'])
  transport.sendFrame(new Uint8Array(7))
  expect(calls.filter((call) => call.command === 'bridge_frame')).toHaveLength(2)
})

it('close tells the Rust side, silences the channel, and is not reported as a lost link', async () => {
  const { events, handlers } = recorder()
  const { ipc, calls, channels } = fakeIpc()
  const transport = tauriTransport(handlers, async () => ipc)
  await flush()
  transport.close()
  channels[0].onmessage({ type: 'ping', ms: 1 })
  expect(calls.at(-1)).toEqual({ command: 'bridge_close', args: undefined })
  expect(events).toEqual(['open'])
  expect(transport.isOpen()).toBe(false)
})

it('picks the transport from the endpoint', async () => {
  const sockets: string[] = []
  vi.stubGlobal('WebSocket', class { constructor(url: string) { sockets.push(url) } })
  const { events, handlers } = recorder()
  // outside a Tauri webview the real @tauri-apps/api has nothing to talk to: the link closes, and no socket was tried
  expect(openBridgeTransport(handlers, { kind: 'tauri' })).not.toBeNull()
  await vi.waitFor(() => expect(events).toEqual(['close']))
  expect(sockets).toEqual([])
  expect(openBridgeTransport(handlers, null)).toBeNull()
  expect(openBridgeTransport(handlers, { kind: 'websocket', url: 'ws://localhost:5173/bridge' })).not.toBeNull()
  expect(sockets).toEqual(['ws://localhost:5173/bridge'])
})
