import { describe, expect, it } from 'vitest'
import { buildArtnetPackets, buildDdpPackets, buildDnrgbPackets, buildSacnPackets, parseOsc } from './bridge'

const pixels = (count: number) => Buffer.from(Array.from({ length: count * 3 }, (_, i) => i % 256))

describe('DDP', () => {
  it('splits at 480 pixels, sets the byte offset, and pushes only with the last packet', () => {
    const packets = buildDdpPackets(pixels(500), 3)
    expect(packets.map((p) => p.length)).toEqual([10 + 1440, 10 + 60])
    expect([packets[0][0], packets[1][0]]).toEqual([0x40, 0x41])
    expect(packets[0][1]).toBe(3)
    expect(packets[1].readUInt32BE(4)).toBe(1440)
    expect(packets[1].readUInt16BE(8)).toBe(60)
    expect([...packets[1].subarray(10, 13)]).toEqual([1440 % 256, 1441 % 256, 1442 % 256])
  })
})

describe('WLED DNRGB', () => {
  it('addresses each packet by its first LED', () => {
    const packets = buildDnrgbPackets(pixels(500))
    expect(packets.map((p) => [p[0], p[1], p.readUInt16BE(2), p.length])).toEqual([
      [4, 2, 0, 4 + 489 * 3],
      [4, 2, 489, 4 + 11 * 3],
    ])
  })
})

describe('Art-Net', () => {
  it('writes an ArtDmx header per universe of 170 pixels', () => {
    const packets = buildArtnetPackets(pixels(200), 7, 300)
    expect(packets).toHaveLength(2)
    const [first, second] = packets
    expect(first.subarray(0, 8).toString('latin1')).toBe('Art-Net\0')
    expect(first.readUInt16LE(8)).toBe(0x5000)
    expect(first.readUInt16BE(10)).toBe(14)
    expect(first[12]).toBe(8)
    // port address 300 = 0x012c: low byte in SubUni, high bits in Net
    expect([first[14], first[15]]).toEqual([0x2c, 0x01])
    expect(first.readUInt16BE(16)).toBe(510)
    expect(first.length).toBe(18 + 510)
    expect([second[14], second[15]]).toEqual([0x2d, 0x01])
    expect(second.readUInt16BE(16)).toBe(90)
    expect([...second.subarray(18, 21)]).toEqual([510 % 256, 511 % 256, 512 % 256])
  })

  it('pads an odd channel count to even and never sends sequence 0', () => {
    const [packet] = buildArtnetPackets(pixels(1), 254)
    expect(packet.readUInt16BE(16)).toBe(4)
    expect(packet[12]).toBe(255)
    expect(buildArtnetPackets(pixels(1), 255)[0][12]).toBe(1)
  })
})

describe('sACN (E1.31)', () => {
  const cid = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')

  it('nests root, framing and DMP layers with the lengths the spec counts from each layer', () => {
    const [packet] = buildSacnPackets(pixels(170), 9, 1, cid)
    expect(packet.length).toBe(126 + 510)
    expect(packet.readUInt16BE(0)).toBe(0x0010)
    expect(packet.subarray(4, 16).toString('latin1')).toBe('ASC-E1.17\0\0\0')
    expect(packet.readUInt16BE(16)).toBe(0x7000 | (636 - 16))
    expect(packet.readUInt32BE(18)).toBe(4)
    expect(packet.subarray(22, 38).equals(cid)).toBe(true)
    expect(packet.readUInt16BE(38)).toBe(0x7000 | (636 - 38))
    expect(packet.readUInt32BE(40)).toBe(2)
    expect(packet.subarray(44, 51).toString()).toBe('WLEDtoy')
    expect([packet[108], packet[111]]).toEqual([100, 9])
    expect(packet.readUInt16BE(113)).toBe(1)
    expect(packet.readUInt16BE(115)).toBe(0x7000 | (636 - 115))
    expect([packet[117], packet[118]]).toEqual([0x02, 0xa1])
    expect(packet.readUInt16BE(121)).toBe(1)
    expect(packet.readUInt16BE(123)).toBe(511)
    expect(packet[125]).toBe(0)
    expect([...packet.subarray(126, 129)]).toEqual([0, 1, 2])
  })

  it('continues into the next universe, and universe 0 is sent as 1', () => {
    const packets = buildSacnPackets(pixels(171), 0, 0, cid)
    expect(packets.map((p) => p.readUInt16BE(113))).toEqual([1, 2])
    expect(packets[1].length).toBe(126 + 3)
    expect(packets[1].readUInt16BE(123)).toBe(4)
  })
})

describe('OSC', () => {
  const pad = (text: string) => Buffer.concat([Buffer.from(text), Buffer.alloc(4 - (text.length % 4))])
  const float = (v: number) => {
    const b = Buffer.alloc(4)
    b.writeFloatBE(v)
    return b
  }
  const int = (v: number) => {
    const b = Buffer.alloc(4)
    b.writeInt32BE(v)
    return b
  }
  const message = (address: string, tags: string, ...args: Buffer[]) => Buffer.concat([pad(address), pad(`,${tags}`), ...args])

  it('reads ints, floats, strings and booleans', () => {
    expect(parseOsc(message('/fader/1', 'f', float(0.5)))).toEqual([{ address: '/fader/1', args: [0.5] }])
    expect(parseOsc(message('/xy', 'iisT', int(3), int(-7), pad('hello')))).toEqual([{ address: '/xy', args: [3, -7, 'hello', 1] }])
  })

  it('unpacks bundles, nested ones too', () => {
    const element = (m: Buffer) => Buffer.concat([int(m.length), m])
    const bundle = (...messages: Buffer[]) => Buffer.concat([pad('#bundle'), Buffer.alloc(8), ...messages.map(element)])
    const packet = bundle(message('/a', 'f', float(1)), bundle(message('/b', 'i', int(2))))
    expect(parseOsc(packet)).toEqual([
      { address: '/a', args: [1] },
      { address: '/b', args: [2] },
    ])
  })

  it('yields nothing for a packet that is not an OSC message, and throws on a truncated one (the listener drops both)', () => {
    expect(parseOsc(pad('hello'))).toEqual([])
    expect(() => parseOsc(Buffer.from('/abc'))).toThrow(/unterminated/)
  })
})
