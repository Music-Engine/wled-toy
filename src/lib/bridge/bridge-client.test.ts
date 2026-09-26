import { afterEach, expect, it, vi } from 'vitest'
import type { AppConfig } from '@/lib/app/settings/config'
import type { BridgeConfigMessage, BridgeTransport, TransportHandlers } from './bridge-transport'

// preferences.ts reads storage at import time
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
vi.stubGlobal('window', { addEventListener: () => undefined })

afterEach(() => vi.useRealTimers())

const config = { host: ' 10.0.0.5 ', protocol: 'ddp', universe: 3, ledCount: 60 } as AppConfig

it('a page with neither a dev server nor Tauri goes offline once: no socket, no retry, one log line', async () => {
  vi.useFakeTimers()
  const WebSocket = Object.assign(vi.fn(), { OPEN: 1 })
  vi.stubGlobal('WebSocket', WebSocket)
  vi.stubGlobal('location', new URL('file:///index.html'))
  const { createBridge } = await import('./bridge-client')
  const { logs } = await import('@/lib/app/logs')
  const before = logs.value.length
  const bridge = createBridge(config)
  bridge.connect()
  vi.advanceTimersByTime(10_000)
  expect(WebSocket).not.toHaveBeenCalled()
  expect(bridge.stats.status).toBe('disconnected')
  expect(logs.value.slice(before).map((entry) => entry.level)).toEqual(['warn'])
  expect(bridge.sendFrame(new Uint8Array(4 + 180))).toBe(false)
  bridge.dispose()
})

function fakeTransport() {
  const links: { handlers: TransportHandlers; configs: BridgeConfigMessage[]; frames: Uint8Array[]; open: boolean; congested: boolean; closed: boolean }[] = []
  const open = (handlers: TransportHandlers): BridgeTransport => {
    const link = { handlers, configs: [] as BridgeConfigMessage[], frames: [] as Uint8Array[], open: false, congested: false, closed: false }
    links.push(link)
    return {
      isOpen: () => link.open,
      congested: () => link.congested,
      sendConfig: (message) => void link.configs.push(message),
      sendFrame: (frame) => void link.frames.push(frame.slice()),
      close: () => void (link.closed = true),
    }
  }
  return { links, open }
}

it('whatever the transport: connecting until it opens, config on open, frame ids, acks into the stats, retry after a close', async () => {
  vi.useFakeTimers()
  const { createBridge } = await import('./bridge-client')
  const transport = fakeTransport()
  const bridge = createBridge(config, transport.open)
  bridge.connect()
  const [link] = transport.links
  expect(bridge.stats.status).toBe('connecting')
  expect(bridge.sendFrame(new Uint8Array(4 + 3))).toBe(false)

  link.open = true
  link.handlers.onOpen()
  expect(bridge.stats.status).toBe('connected')
  expect(link.configs).toEqual([{ type: 'config', host: '10.0.0.5', protocol: 'ddp', universe: 3, oscPort: 0 }])

  expect(bridge.sendFrame(new Uint8Array([0, 0, 0, 0, 9, 8, 7]))).toBe(true)
  expect(bridge.sendFrame(new Uint8Array(4 + 3))).toBe(true)
  expect(link.frames.map((frame) => [...frame.subarray(0, 5)])).toEqual([[1, 0, 0, 0, 9], [2, 0, 0, 0, 0]])

  link.congested = true
  expect(bridge.sendFrame(new Uint8Array(4 + 3))).toBe(false)
  link.congested = false

  vi.advanceTimersByTime(5)
  link.handlers.onMessage({ type: 'ack', frameId: 1, count: 1, udpMs: 0.25, bytes: 1000 })
  link.handlers.onMessage({ type: 'drop', frameId: 2 })
  link.handlers.onMessage({ type: 'device', name: 'Shelf', version: '0.15.0', ledCount: 60 })
  link.handlers.onMessage({ type: 'ping', ms: 12, fps: 40 })
  vi.advanceTimersByTime(1000)
  expect(bridge.stats).toMatchObject({ framesSent: 2, framesDropped: 2, udpMs: 0.25, rttMs: 5, deviceMs: 12, deviceFps: 40, device: { name: 'Shelf', ledCount: 60 } })
  expect(bridge.stats.kbps).toBeCloseTo(8, 0)

  link.open = false
  link.handlers.onClose()
  expect(bridge.stats).toMatchObject({ status: 'disconnected', device: null })
  vi.advanceTimersByTime(1500)
  expect(transport.links).toHaveLength(2)
  expect(bridge.stats.status).toBe('connecting')

  bridge.dispose()
  expect(transport.links[1].closed).toBe(true)
})

it('one ack for a batch of frames: bytes add up, the round trip is timed on its newest frame, and the older ones are settled', async () => {
  vi.useFakeTimers()
  const { createBridge } = await import('./bridge-client')
  const transport = fakeTransport()
  const bridge = createBridge(config, transport.open)
  bridge.connect()
  const [link] = transport.links
  link.open = true
  link.handlers.onOpen()

  for (let i = 0; i < 3; i++) {
    bridge.sendFrame(new Uint8Array(4 + 3))
    vi.advanceTimersByTime(10)
  }
  vi.advanceTimersByTime(70)
  link.handlers.onMessage({ type: 'ack', frameId: 3, count: 3, udpMs: 0.5, bytes: 3000 })
  // frame 1 was covered by the batch: a stray ack for it no longer counts as a round trip
  link.handlers.onMessage({ type: 'ack', frameId: 1, count: 1, udpMs: 0.5, bytes: 0 })
  vi.advanceTimersByTime(900)
  expect(bridge.stats).toMatchObject({ framesSent: 3, framesDropped: 0, udpMs: 0.5, rttMs: 80 })
  expect(bridge.stats.kbps).toBeCloseTo(24, 0)
  bridge.dispose()
})

it('reports a failing link once per outage: repeated retries stay quiet until a reconnect or a new cause', async () => {
  vi.useFakeTimers()
  const { createBridge } = await import('./bridge-client')
  const { logs } = await import('@/lib/app/logs')
  const transport = fakeTransport()
  const bridge = createBridge(config, transport.open)
  const errors = () => logs.value.filter((entry) => entry.level === 'error').map((entry) => entry.message)
  const before = errors().length
  const failLatest = (cause: unknown) => {
    transport.links.at(-1)!.handlers.onClose(cause)
    vi.advanceTimersByTime(1500)
  }
  bridge.connect()
  for (let retry = 0; retry < 3; retry++) failLatest('bridge refused')
  expect(errors().slice(before)).toEqual(['The link to the desktop bridge failed [bridge link-failed] (cause: bridge refused)'])

  transport.links.at(-1)!.handlers.onOpen()
  failLatest('bridge refused')
  expect(errors().slice(before)).toHaveLength(2)
  failLatest('port in use')
  expect(errors().slice(before)).toHaveLength(3)
  bridge.dispose()
})
