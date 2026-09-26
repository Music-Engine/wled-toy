import { reactive } from 'vue'
import { log, report } from '@/lib/app/logs'
import { BridgeError } from './bridge-error'
import type { AppConfig } from '@/lib/app/settings/config'
import { openBridgeTransport, type BridgeMessage, type BridgeTransport, type TransportHandlers } from './bridge-transport'

export type BridgeStatus = 'connecting' | 'connected' | 'disconnected'

export interface DeviceInfo {
  name: string
  version: string
  ledCount: number
}

export interface BridgeStats {
  renderFps: number
  sendFps: number
  framesSent: number
  framesDropped: number
  kbps: number
  ledRenderMs: number | null
  rttMs: number | null
  udpMs: number | null
  deviceMs: number | null
  deviceFps: number | null
  status: BridgeStatus
  device: DeviceInfo | null
}

export type HistoryKey = 'renderFps' | 'sendFps' | 'kbps' | 'ledRenderMs' | 'rttMs' | 'udpMs' | 'deviceMs'

const HISTORY_LENGTH = 60

const smooth = (prev: number | null, next: number) => (prev == null ? next : prev * 0.8 + next * 0.2)

export function createBridge(config: AppConfig, openTransport: (handlers: TransportHandlers) => BridgeTransport | null = openBridgeTransport) {
  const stats = reactive<BridgeStats>({
    renderFps: 0, sendFps: 0, framesSent: 0, framesDropped: 0, kbps: 0,
    ledRenderMs: null, rttMs: null, udpMs: null, deviceMs: null, deviceFps: null,
    status: 'connecting', device: null,
  })
  const history = reactive<Record<HistoryKey, number[]>>({
    renderFps: [], sendFps: [], kbps: [], ledRenderMs: [], rttMs: [], udpMs: [], deviceMs: [],
  })

  // per-frame values live outside the reactive object and are published once per second
  const raw = { render: 0, send: 0, bytes: 0, sent: 0, dropped: 0, last: performance.now(), rtt: null as number | null, udp: null as number | null, led: null as number | null }
  const pending = new Map<number, number>()
  let frameId = 0
  let link: BridgeTransport | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  // a retry every 1.5 s against a bridge that keeps failing would repeat the same report; one per outage and cause is enough
  let reportedCause: string | null = null

  const publish = setInterval(() => {
    const now = performance.now()
    const dt = (now - raw.last) / 1000
    Object.assign(stats, {
      renderFps: raw.render / dt,
      sendFps: raw.send / dt,
      kbps: (raw.bytes * 8) / 1000 / dt,
      framesSent: raw.sent,
      framesDropped: raw.dropped,
      rttMs: raw.rtt,
      udpMs: raw.udp,
      ledRenderMs: raw.led,
    })
    Object.assign(raw, { render: 0, send: 0, bytes: 0, last: now })
    for (const key of Object.keys(history) as HistoryKey[]) {
      const series = history[key]
      series.push(stats[key] ?? 0)
      if (series.length > HISTORY_LENGTH) series.shift()
    }
  }, 1000)

  let wire: { protocol: string; universe: number } | null = null
  let oscPort = 0
  // numeric arguments of the latest message per OSC address
  const osc = new Map<string, number[]>()

  /** Tells the bridge where and how to send. `override` replaces the protocol from Settings until it is cleared with null. */
  function sendConfig(override: { protocol: string; universe: number } | null | undefined = wire) {
    wire = override
    if (link?.isOpen()) {
      link.sendConfig({ type: 'config', host: config.host.trim(), protocol: wire?.protocol ?? config.protocol, universe: wire?.universe ?? config.universe, oscPort })
    }
  }

  function connect() {
    stats.status = 'connecting'
    link = openTransport({ onOpen, onClose, onMessage })
    if (!link) {
      stats.status = 'disconnected'
      log('This build has no UDP bridge: frames are preview only', 'warn')
    }
  }

  function onOpen() {
    reportedCause = null
    stats.status = 'connected'
    log('UDP bridge connected')
    sendConfig()
  }

  function onClose(cause?: unknown) {
    if (disposed) return
    const message = cause instanceof Error ? cause.message : String(cause)
    if (cause !== undefined && message !== reportedCause) {
      reportedCause = message
      report(new BridgeError('link-failed', 'The link to the desktop bridge failed', cause))
    }
    stats.status = 'disconnected'
    stats.device = null
    log('UDP bridge disconnected, retrying', 'warn')
    reconnectTimer = setTimeout(connect, 1500)
  }

  function onMessage(msg: BridgeMessage) {
    switch (msg.type) {
      case 'ack': {
        // an ack covers every frame up to frameId; the round trip is measured on that newest one
        const sentAt = pending.get(msg.frameId)
        for (const id of pending.keys()) {
          if (id > msg.frameId) break
          pending.delete(id)
        }
        if (sentAt !== undefined) raw.rtt = smooth(raw.rtt, performance.now() - sentAt)
        raw.udp = smooth(raw.udp, msg.udpMs)
        raw.bytes += msg.bytes
        break
      }
      case 'drop':
        pending.delete(msg.frameId)
        raw.dropped++
        break
      case 'log':
        log(msg.msg, msg.level)
        break
      case 'ping':
        stats.deviceMs = msg.ms
        stats.deviceFps = msg.fps ?? null
        break
      case 'osc':
        osc.set(msg.address, msg.args.filter((arg): arg is number => typeof arg === 'number'))
        break
      case 'device':
        stats.device = { name: msg.name, version: msg.version, ledCount: msg.ledCount }
        if (msg.ledCount !== config.ledCount) log(`Device reports ${msg.ledCount} LEDs, settings use ${config.ledCount}`, 'warn')
        break
    }
  }

  /** Sends a frame from ShaderRenderer.renderLeds; drops it when the link to the bridge is backed up. */
  function sendFrame(frame: Uint8Array<ArrayBuffer>): boolean {
    if (!link?.isOpen()) return false
    // drop rather than queue: a stale LED frame is worse than a skipped one
    if (link.congested(frame.length)) {
      raw.dropped++
      return false
    }
    const id = ++frameId
    new DataView(frame.buffer).setUint32(0, id, true)
    pending.set(id, performance.now())
    if (pending.size > 200) pending.delete(pending.keys().next().value!)
    link.sendFrame(frame)
    raw.sent++
    raw.send++
    return true
  }

  return {
    stats,
    history,
    connect,
    sendConfig,
    /** Has the bridge listen for OSC on this UDP port; 0 stops listening. */
    listenOsc(port: number) {
      if (port === oscPort) return
      oscPort = port
      sendConfig()
    },
    oscArgs: (address: string) => osc.get(address),
    sendFrame,
    countRender: () => raw.render++,
    recordLedRender: (ms: number) => (raw.led = smooth(raw.led, ms)),
    dispose() {
      disposed = true
      clearInterval(publish)
      clearTimeout(reconnectTimer)
      link?.close()
    },
  }
}

export type Bridge = ReturnType<typeof createBridge>
