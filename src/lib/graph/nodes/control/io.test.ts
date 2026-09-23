import { describe, expect, it, vi } from 'vitest'
import { FrameRunner, generateGlsl } from '@/lib/graph'
import { graph, node } from '@/lib/graph/testing'

vi.stubGlobal('navigator', {})
const { MidiService } = await import('@/lib/engine/midi')

const frame = { time: 0, dt: 1 / 30, frameIndex: 0 }

function firstSlot(doc: ReturnType<typeof graph>, extra: object) {
  const shader = generateGlsl(doc)
  expect(shader.error).toBeNull()
  const runner = new FrameRunner()
  runner.load(shader.frame)
  return () => runner.step({ ...frame, ...extra })[0]
}

describe('MIDI In', () => {
  it('CC 74 at 64 reads 0.504, on the channel asked for or on any', () => {
    const midi = new MidiService()
    const read = (values: object) => firstSlot(graph([node('m', 'midiIn', values as never), node('o', 'output')], [['m.value', 'o.color']]), { midi })
    const any = read({ number: 74 })
    const channelTwo = read({ number: 74, channel: 2 })
    expect(any()).toBe(0)
    midi.receive(Uint8Array.of(0xb0, 74, 64))
    expect(any()).toBeCloseTo(0.504, 3)
    expect(channelTwo()).toBe(0)
    midi.receive(Uint8Array.of(0xb1, 74, 127))
    expect(channelTwo()).toBe(1)
  })

  it('a note gives its velocity and a gate that falls on release', () => {
    const midi = new MidiService()
    const gate = firstSlot(graph([node('m', 'midiIn', { kind: 'note', number: 60 }), node('o', 'output')], [['m.gate', 'o.color']]), { midi })
    midi.receive(Uint8Array.of(0x90, 60, 100))
    expect(gate()).toBe(1)
    midi.receive(Uint8Array.of(0x80, 60, 0))
    expect(gate()).toBe(0)
  })
})

describe('OSC In', () => {
  it('reads the arguments of its address and nothing else', () => {
    const messages = new Map([['/1/fader1', [0.25, 0.75]]])
    const osc = (address: string) => messages.get(address)
    const second = firstSlot(graph([node('i', 'oscIn'), node('o', 'output')], [['i.second', 'o.color']]), { osc })
    const other = firstSlot(graph([node('i', 'oscIn', { address: '/other' }), node('o', 'output')], [['i.value', 'o.color']]), { osc })
    expect(second()).toBe(0.75)
    expect(other()).toBe(0)
  })

  it('asks for its port; of two on different ports the first is opened and the other says so', () => {
    const one = generateGlsl(graph([node('i', 'oscIn'), node('o', 'output')], [['i.value', 'o.color']]))
    const two = generateGlsl(graph(
      [node('i', 'oscIn'), node('j', 'oscIn', { port: 9001 }), node('m', 'math'), node('o', 'output')],
      [['i.value', 'm.a'], ['j.value', 'm.b'], ['m.result', 'o.color']],
    ))
    expect(one.frame.resources.osc).toEqual([9000])
    expect(two.frame.resources.osc).toEqual([9000])
    expect(two.issues).toEqual([{ nodeId: 'j', message: 'Another OSC In listens on port 9000; one port is open at a time, so this one reads that port' }])
  })
})

describe('Knob', () => {
  it('keeps its value inside its range, whichever way round the range is given', () => {
    const value = (values: object) => firstSlot(graph([node('k', 'knob', values as never), node('o', 'output')], [['k.value', 'o.color']]), {})()
    expect(value({ value: 5, min: 0, max: 2 })).toBe(2)
    expect(value({ value: -1, min: 2, max: 0 })).toBe(0)
    expect(value({ value: 0.3 })).toBeCloseTo(0.3)
  })
})
