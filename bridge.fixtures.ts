import { mkdirSync, writeFileSync } from 'node:fs'
import { buildArtnetPackets, buildDdpPackets, buildDnrgbPackets, buildFramePackets, buildSacnPackets, nextSeq, type Protocol } from './bridge.ts'

/*
 * Golden UDP packets for the Rust bridge (src-tauri/src/bridge/packets.rs), built by the Node bridge.
 * Regenerate with `node bridge.fixtures.ts`; bridge.fixtures.test.ts fails when the files on disk are stale.
 * File format: each packet as a uint32 BE length followed by its bytes.
 */
export const fixtureDir = new URL('./src-tauri/tests/fixtures/', import.meta.url)

const pixels = (count: number) => Buffer.from(Array.from({ length: count * 3 }, (_, i) => (i * 7 + 3) % 256))
const cid = Buffer.from(Array.from({ length: 16 }, (_, i) => 0xa0 + i))

const framed = (packets: Buffer[]) =>
  Buffer.concat(
    packets.flatMap((p) => {
      const length = Buffer.alloc(4)
      length.writeUInt32BE(p.length)
      return [length, p]
    }),
  )

// frames around every point where a sequence field wraps: DDP at 15, Art-Net at 255, sACN at 256, the counter itself at 3825
const sequenceFrames = [0, 13, 14, 15, 253, 254, 255, 256, 3823, 3824, 3825]

function sequence(protocol: Protocol): Buffer[] {
  const packets: Buffer[] = []
  for (let frame = 0, seq = 1; frame <= 3825; frame++, seq = nextSeq(seq)) {
    if (sequenceFrames.includes(frame)) packets.push(...buildFramePackets(protocol, Buffer.from([frame & 0xff, 1, 2, 3, 4, 5]), seq, 4, cid))
  }
  return packets
}

export const fixtures = (): Record<string, Buffer> => ({
  'ddp_500px.bin': framed(buildDdpPackets(pixels(500), 3)),
  'ddp_960px.bin': framed(buildDdpPackets(pixels(960), 15)),
  'ddp_1200px.bin': framed(buildDdpPackets(pixels(1200), 1)),
  'dnrgb_1000px.bin': framed(buildDnrgbPackets(pixels(1000))),
  'artnet_400px_u300.bin': framed(buildArtnetPackets(pixels(400), 7, 300)),
  'artnet_171px_u255.bin': framed(buildArtnetPackets(pixels(171), 254, 255)),
  'artnet_341px_u32767.bin': framed(buildArtnetPackets(pixels(341), 255, 32767)),
  'sacn_400px_u0.bin': framed(buildSacnPackets(pixels(400), 300, 0, cid)),
  'sacn_171px_u255.bin': framed(buildSacnPackets(pixels(171), 255, 255, cid)),
  'sequence_ddp.bin': framed(sequence('ddp')),
  'sequence_dnrgb.bin': framed(sequence('dnrgb')),
  'sequence_artnet.bin': framed(sequence('artnet')),
  'sequence_sacn.bin': framed(sequence('sacn')),
})

if (import.meta.main) {
  mkdirSync(fixtureDir, { recursive: true })
  for (const [name, bytes] of Object.entries(fixtures())) writeFileSync(new URL(name, fixtureDir), bytes)
}
