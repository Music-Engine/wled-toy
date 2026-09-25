import { randomBytes } from 'node:crypto'
import dgram from 'node:dgram'
import type { Server as HttpServer } from 'node:http'
import type { Http2SecureServer } from 'node:http2'
import { WebSocketServer, type WebSocket } from 'ws'
import { WLEDClient } from 'wled-client'

const DDP_PORT = 4048
const DNRGB_PORT = 21324
const ARTNET_PORT = 6454
const SACN_PORT = 5568
const DDP_MAX_PIXELS = 480
const DNRGB_MAX_PIXELS = 489
// a DMX universe has 512 slots; whole RGB pixels fill 510 of them
const DMX_PIXELS = 170

export type Protocol = 'ddp' | 'dnrgb' | 'artnet' | 'sacn'
const PORTS: Record<Protocol, number> = { ddp: DDP_PORT, dnrgb: DNRGB_PORT, artnet: ARTNET_PORT, sacn: SACN_PORT }

export function buildDdpPackets(rgb: Buffer, seq: number): Buffer[] {
  const packets: Buffer[] = []
  for (let offset = 0; offset < rgb.length; offset += DDP_MAX_PIXELS * 3) {
    const len = Math.min(DDP_MAX_PIXELS * 3, rgb.length - offset)
    const last = offset + len >= rgb.length
    const pkt = Buffer.alloc(10 + len)
    // version 1, push flag only on the final packet so WLED shows the frame once complete
    pkt[0] = 0x40 | (last ? 0x01 : 0x00)
    pkt[1] = seq & 0x0f
    pkt[2] = 0x01
    pkt[3] = 0x01
    pkt.writeUInt32BE(offset, 4)
    pkt.writeUInt16BE(len, 8)
    rgb.copy(pkt, 10, offset, offset + len)
    packets.push(pkt)
  }
  return packets
}

export function buildDnrgbPackets(rgb: Buffer, timeoutSec = 2): Buffer[] {
  const packets: Buffer[] = []
  const leds = rgb.length / 3
  for (let start = 0; start < leds; start += DNRGB_MAX_PIXELS) {
    const count = Math.min(DNRGB_MAX_PIXELS, leds - start)
    const pkt = Buffer.alloc(4 + count * 3)
    pkt[0] = 4
    pkt[1] = timeoutSec
    pkt.writeUInt16BE(start, 2)
    rgb.copy(pkt, 4, start * 3, (start + count) * 3)
    packets.push(pkt)
  }
  return packets
}

/** One ArtDmx packet per universe of 170 pixels, counting up from `universe` (a 15-bit port address). */
export function buildArtnetPackets(rgb: Buffer, seq: number, universe = 0): Buffer[] {
  const packets: Buffer[] = []
  for (let offset = 0, u = universe; offset < rgb.length; offset += DMX_PIXELS * 3, u++) {
    const data = rgb.subarray(offset, offset + DMX_PIXELS * 3)
    // DMX lengths are even
    const length = data.length + (data.length % 2)
    const pkt = Buffer.alloc(18 + length)
    pkt.write('Art-Net\0', 0, 'latin1')
    pkt.writeUInt16LE(0x5000, 8)
    pkt.writeUInt16BE(14, 10)
    // 0 would tell the receiver to ignore ordering
    pkt[12] = (seq % 255) + 1
    pkt[13] = 0
    pkt[14] = u & 0xff
    pkt[15] = (u >> 8) & 0x7f
    pkt.writeUInt16BE(length, 16)
    data.copy(pkt, 18)
    packets.push(pkt)
  }
  return packets
}

/** One E1.31 (streaming ACN) data packet per universe of 170 pixels. Universes start at 1. `cid` identifies this sender. */
export function buildSacnPackets(rgb: Buffer, seq: number, universe: number, cid: Buffer, source = 'WLEDtoy'): Buffer[] {
  const packets: Buffer[] = []
  for (let offset = 0, u = Math.max(1, universe); offset < rgb.length; offset += DMX_PIXELS * 3, u++) {
    const data = rgb.subarray(offset, offset + DMX_PIXELS * 3)
    const total = 126 + data.length
    const pkt = Buffer.alloc(total)
    // root layer
    pkt.writeUInt16BE(0x0010, 0)
    pkt.write('ASC-E1.17', 4, 'latin1')
    pkt.writeUInt16BE(0x7000 | (total - 16), 16)
    pkt.writeUInt32BE(0x00000004, 18)
    cid.copy(pkt, 22, 0, 16)
    // framing layer
    pkt.writeUInt16BE(0x7000 | (total - 38), 38)
    pkt.writeUInt32BE(0x00000002, 40)
    pkt.write(source.slice(0, 63), 44, 'utf8')
    pkt[108] = 100
    pkt[111] = seq & 0xff
    pkt.writeUInt16BE(u, 113)
    // DMP layer
    pkt.writeUInt16BE(0x7000 | (total - 115), 115)
    pkt[117] = 0x02
    pkt[118] = 0xa1
    pkt.writeUInt16BE(0x0001, 121)
    pkt.writeUInt16BE(data.length + 1, 123)
    // pkt[125] is the DMX start code, 0 for dimmer data
    data.copy(pkt, 126)
    packets.push(pkt)
  }
  return packets
}

/** The UDP packets of one frame. `seq` is the per-connection frame counter that `nextSeq` advances; each protocol folds it into its own sequence field. */
export function buildFramePackets(protocol: Protocol, rgb: Buffer, seq: number, universe: number, cid: Buffer): Buffer[] {
  return protocol === 'ddp' ? buildDdpPackets(rgb, (seq % 15) + 1)
    : protocol === 'dnrgb' ? buildDnrgbPackets(rgb)
      : protocol === 'artnet' ? buildArtnetPackets(rgb, seq, universe)
        : buildSacnPackets(rgb, seq, universe, cid)
}

// 3825 = 15 * 255: the DDP and Art-Net sequence fields both wrap cleanly here
export const nextSeq = (seq: number) => (seq + 1) % 3825

export interface OscMessage {
  address: string
  /** Numbers as they are; strings kept; true and false as 1 and 0. */
  args: (number | string)[]
}

/** Decodes an OSC 1.0 packet: one message, or a bundle of messages (bundles may nest). Unknown argument types end the message. */
export function parseOsc(packet: Buffer): OscMessage[] {
  const padded = (n: number) => (n + 4) & ~3
  const readString = (at: number) => {
    const end = packet.indexOf(0, at)
    if (end < 0) throw new Error('unterminated OSC string')
    return { text: packet.toString('utf8', at, end), next: at + padded(end - at) }
  }
  if (packet.subarray(0, 8).toString('latin1') === '#bundle\0') {
    const messages: OscMessage[] = []
    // 8 bytes of tag, 8 of time tag, then size-prefixed elements
    for (let at = 16; at + 4 <= packet.length;) {
      const size = packet.readInt32BE(at)
      messages.push(...parseOsc(packet.subarray(at + 4, at + 4 + size)))
      at += 4 + size
    }
    return messages
  }
  const address = readString(0)
  if (!address.text.startsWith('/') || packet[address.next] !== 0x2c) return []
  const tags = readString(address.next)
  const args: (number | string)[] = []
  let at = tags.next
  for (const tag of tags.text.slice(1)) {
    if (tag === 'i') { args.push(packet.readInt32BE(at)); at += 4 }
    else if (tag === 'f') { args.push(packet.readFloatBE(at)); at += 4 }
    else if (tag === 'd') { args.push(packet.readDoubleBE(at)); at += 8 }
    else if (tag === 's') { const s = readString(at); args.push(s.text); at = s.next }
    else if (tag === 'T') args.push(1)
    else if (tag === 'F') args.push(0)
    else break
  }
  return [{ address: address.text, args }]
}

type BridgeServer = (HttpServer | Http2SecureServer) & {
  __wledBridge?: { onUpgrade: (...args: any[]) => void; wss: WebSocketServer }
}

export function attachBridge(httpServer: HttpServer | Http2SecureServer, log: (msg: string) => void = console.log) {
  const server = httpServer as BridgeServer
  const wss = new WebSocketServer({ noServer: true })
  // Vite restarts reuse the same http server on config changes; drop the stale handler
  if (server.__wledBridge) {
    server.off('upgrade', server.__wledBridge.onUpgrade)
    server.__wledBridge.wss.clients.forEach((c) => c.terminate())
    server.__wledBridge.wss.close()
  }
  const onUpgrade = (req: { url?: string }, socket: any, head: Buffer) => {
    if (req.url !== '/bridge') return
    wss.handleUpgrade(req as any, socket, head, (ws) => wss.emit('connection', ws))
  }
  server.on('upgrade', onUpgrade)
  server.__wledBridge = { onUpgrade, wss }

  wss.on('connection', (ws: WebSocket) => handleConnection(ws, log))
}

function handleConnection(ws: WebSocket, log: (msg: string) => void) {
  const udp = dgram.createSocket('udp4')
  let host = ''
  let protocol: Protocol = 'ddp'
  let universe = 0
  let seq = 1
  const cid = randomBytes(16)
  let wled: WLEDClient | null = null
  let pingTimer: ReturnType<typeof setInterval> | undefined
  let configGeneration = 0

  const send = (obj: object) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(obj))
  const emitLog = (level: 'info' | 'warn' | 'error', msg: string) => {
    log(`[bridge] ${msg}`)
    send({ type: 'log', level, msg })
  }

  udp.on('error', (e) => emitLog('error', `UDP error: ${e.message}`))

  const ping = async () => {
    if (!wled) return
    const t0 = performance.now()
    try {
      await wled.refreshInfo()
      send({ type: 'ping', ms: performance.now() - t0, fps: wled.info.leds?.fps })
    } catch {
      send({ type: 'ping', ms: null })
    }
  }

  let osc: dgram.Socket | null = null
  let oscPort = 0
  const listenOsc = (port: number) => {
    if (port === oscPort) return
    osc?.close()
    osc = null
    oscPort = port
    if (!port) return
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    socket.on('error', (e) => emitLog('error', `OSC listener: ${e.message}`))
    socket.on('message', (packet) => {
      try {
        for (const message of parseOsc(packet)) send({ type: 'osc', ...message })
      } catch {
        // a malformed packet from the network is dropped, not fatal
      }
    })
    socket.bind(port, () => emitLog('info', `Listening for OSC on UDP ${port}`))
    osc = socket
  }

  const configure = async (cfg: { host?: string; protocol?: string; universe?: number; oscPort?: number }) => {
    listenOsc(Number.isInteger(cfg.oscPort) && cfg.oscPort! > 0 && cfg.oscPort! < 65536 ? cfg.oscPort! : 0)
    const generation = ++configGeneration
    host = (cfg.host ?? '').trim()
    protocol = cfg.protocol && cfg.protocol in PORTS ? (cfg.protocol as Protocol) : 'ddp'
    universe = Number.isInteger(cfg.universe) ? Math.min(32767, Math.max(0, cfg.universe!)) : 0
    clearInterval(pingTimer)
    wled = null
    if (!host) return emitLog('warn', 'No host configured; frames are preview only')
    emitLog('info', `Target ${host} via ${protocol.toUpperCase()}`)
    try {
      const client = new WLEDClient({ host, websocket: false, immediate: false })
      // init() swallows HTTP failures when websocket is disabled; refreshInfo() rejects instead
      await client.refreshInfo()
      if (!client.info?.version) throw new Error('no device info returned')
      // a newer config arrived while this one was connecting
      if (generation !== configGeneration) return
      wled = client
      const { name, version, leds } = client.info
      emitLog('info', `wled-client: "${name}" v${version}, ${leds.count} LEDs, fps ${leds.fps}`)
      send({ type: 'device', name, version, ledCount: leds.count })
      pingTimer = setInterval(ping, 2000)
      ping()
    } catch (e) {
      if (generation !== configGeneration) return
      // Art-Net and sACN receivers need not be WLED; without its API there is just no device info or ping
      if (protocol === 'artnet' || protocol === 'sacn') emitLog('info', `No WLED API at ${host}; sending ${protocol} anyway`)
      else emitLog('error', `wled-client could not reach ${host}: ${(e as Error).message ?? e}`)
    }
  }

  ws.on('message', (data: Buffer, isBinary: boolean) => {
    if (!isBinary) {
      const msg = JSON.parse(data.toString())
      if (msg.type === 'config') configure(msg)
      return
    }
    const frameId = data.readUInt32LE(0)
    const rgb = data.subarray(4)
    const t0 = performance.now()
    let bytes = 0
    if (host) {
      const packets = buildFramePackets(protocol, rgb, seq, universe, cid)
      seq = nextSeq(seq)
      for (const p of packets) {
        udp.send(p, PORTS[protocol], host)
        bytes += p.length
      }
    }
    send({ type: 'ack', frameId, count: 1, udpMs: performance.now() - t0, bytes })
  })

  ws.on('close', () => {
    configGeneration++
    clearInterval(pingTimer)
    udp.close()
    osc?.close()
  })
}
