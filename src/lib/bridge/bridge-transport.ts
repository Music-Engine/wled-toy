import type { LogLevel } from '@/lib/app/logs'
import { bridgeEndpoint, type BridgeEndpoint } from '@/lib/app/platform'

export type BridgeMessage =
  /** The `count` frames sent since the previous ack, up to `frameId`: `udpMs` is their mean, `bytes` their sum. */
  | { type: 'ack'; frameId: number; count: number; udpMs: number; bytes: number }
  /** Only the Tauri bridge sends it: a frame that newer ones pushed out of its send queue. */
  | { type: 'drop'; frameId: number }
  | { type: 'log'; level: LogLevel; msg: string }
  | { type: 'ping'; ms: number | null; fps?: number }
  | { type: 'device'; name: string; version: string; ledCount: number }
  | { type: 'osc'; address: string; args: (number | string)[] }

export interface BridgeConfigMessage {
  type: 'config'
  host: string
  protocol: string
  universe: number
  oscPort: number
}

export interface TransportHandlers {
  onOpen(): void
  /** At most once, also when the link never opened. Not called after `close()`. `cause` is why the link failed, when it did. */
  onClose(cause?: unknown): void
  onMessage(message: BridgeMessage): void
}

/** One attempt at a link to a bridge, as one WebSocket is: it opens at most once and is replaced after it closes. */
export interface BridgeTransport {
  isOpen(): boolean
  /** Frames are piling up on the way to the bridge: skip this one. */
  congested(frameLength: number): boolean
  sendConfig(config: BridgeConfigMessage): void
  /** `frame` starts with the uint32 LE frame id, then RGB bytes. */
  sendFrame(frame: Uint8Array<ArrayBuffer>): void
  close(): void
}

/** The Node bridge (bridge.ts) on the Vite dev or preview server. */
export function webSocketTransport(url: string, handlers: TransportHandlers): BridgeTransport {
  const socket = new WebSocket(url)
  let closed = false
  socket.onopen = () => handlers.onOpen()
  socket.onclose = () => { if (!closed) handlers.onClose() }
  socket.onmessage = ({ data }) => handlers.onMessage(JSON.parse(data))
  return {
    isOpen: () => socket.readyState === WebSocket.OPEN,
    congested: (frameLength) => socket.bufferedAmount > frameLength * 2,
    sendConfig: (config) => socket.send(JSON.stringify(config)),
    sendFrame: (frame) => socket.send(frame),
    close() {
      closed = true
      socket.close()
    },
  }
}

/** What the Tauri transport uses of `@tauri-apps/api/core`. */
export interface TauriIpc {
  invoke(command: string, args?: Record<string, unknown> | Uint8Array): Promise<unknown>
  Channel: new () => { onmessage: (message: BridgeMessage) => void }
}

/**
 * The Rust bridge (src-tauri/src/bridge). Commands: `bridge_open` with the channel all bridge messages come back on,
 * `bridge_config`, `bridge_frame` with the frame as the raw request body, `bridge_close`.
 */
export function tauriTransport(handlers: TransportHandlers, load: () => Promise<TauriIpc> = () => import('@tauri-apps/api/core')): BridgeTransport {
  let ipc: TauriIpc | null = null
  let closed = false
  let inFlight = 0

  const fail = (cause: unknown) => {
    if (closed) return
    closed = true
    ipc = null
    handlers.onClose(cause)
  }

  void (async () => {
    const loaded = await load()
    const events = new loaded.Channel()
    events.onmessage = (message) => { if (!closed) handlers.onMessage(message) }
    await loaded.invoke('bridge_open', { events })
    if (closed) return
    ipc = loaded
    handlers.onOpen()
  })().catch(fail)

  return {
    isOpen: () => ipc !== null,
    // IPC has no bufferedAmount; requests the Rust side has not taken yet are the same signal
    congested: () => inFlight > 2,
    sendConfig: (config) => void ipc?.invoke('bridge_config', { config }).catch(fail),
    sendFrame(frame) {
      if (!ipc) return
      inFlight++
      ipc.invoke('bridge_frame', frame).then(() => inFlight--, (cause) => { inFlight--; fail(cause) })
    },
    close() {
      const open = ipc
      closed = true
      ipc = null
      // bridge_close cannot fail on the Rust side, so a rejection only means the webview is going away with it
      void open?.invoke('bridge_close').catch(() => undefined)
    },
  }
}

/** Null when this page has no bridge at all. */
export function openBridgeTransport(handlers: TransportHandlers, endpoint: BridgeEndpoint | null = bridgeEndpoint()): BridgeTransport | null {
  if (!endpoint) return null
  return endpoint.kind === 'tauri' ? tauriTransport(handlers) : webSocketTransport(endpoint.url, handlers)
}
