import { describe, expect, it, vi } from 'vitest'
import type { ShaderRenderer } from '@/lib/engine/render/renderer'
import { Runtime } from '@/lib/engine/runtime'
import { createGlslCompiler } from '@/lib/graph'
import { graph, node } from '@/lib/graph/testing'

vi.stubGlobal('navigator', {})
const { MidiService } = await import('@/lib/engine/midi')
type Midi = InstanceType<typeof MidiService>

/** Runtime over a renderer keeping only the uniform block; returns a reader of the float the Output's source reads, after the latest MIDI and OSC */
function loadOutputUniform(
  doc: ReturnType<typeof graph>,
  { midi, osc = () => undefined }: { midi?: Midi; osc?: (address: string) => number[] | undefined } = {},
) {
  const { program, slots, issues } = createGlslCompiler().compile(doc)
  expect(issues).toEqual([])
  let block: Float32Array = new Float32Array()
  const renderer = {
    setControls: (controls: Float32Array) => (block = controls),
    compile: () => 0,
    setAudioReads: () => undefined,
    clearGlobalState: () => undefined,
  }
  const runtime = new Runtime(renderer as unknown as ShaderRenderer)
  runtime.load(program!, slots)
  const linked = doc.edges.find((edge) => edge.target === 'o')!
  const uniform = program!.uniforms.find((u) => u.node === linked.source && u.output === linked.sourceHandle)!
  return () => {
    if (midi) runtime.readMidiAndOsc(midi, osc)
    else runtime.readMidiAndOsc(new MidiService(), osc)
    return block[uniform.offset]
  }
}

describe('MIDI In', () => {
  it('CC 74 at 64 reads 0.504, on the channel asked for or on any', () => {
    const midi = new MidiService()
    const loadReader = (values: object) =>
      loadOutputUniform(graph([node('m', 'midiIn', values as never), node('o', 'output')], [['m.value', 'o.color']]), { midi })
    const readAny = loadReader({ number: 74 })
    const readChannelTwo = loadReader({ number: 74, channel: 2 })
    expect(readAny()).toBe(0)
    midi.receive(Uint8Array.of(0xb0, 74, 64))
    expect(readAny()).toBeCloseTo(0.504, 3)
    expect(readChannelTwo()).toBe(0)
    midi.receive(Uint8Array.of(0xb1, 74, 127))
    expect(readChannelTwo()).toBe(1)
  })

  it('a note gives its velocity and a gate that falls on release', () => {
    const midi = new MidiService()
    const readGate = loadOutputUniform(graph([node('m', 'midiIn', { kind: 'note', number: 60 }), node('o', 'output')], [['m.gate', 'o.color']]), { midi })
    midi.receive(Uint8Array.of(0x90, 60, 100))
    expect(readGate()).toBe(1)
    midi.receive(Uint8Array.of(0x80, 60, 0))
    expect(readGate()).toBe(0)
  })
})

describe('OSC In', () => {
  it('reads the arguments of its address and nothing else', () => {
    const messages = new Map([['/1/fader1', [0.25, 0.75]]])
    const readOsc = (address: string) => messages.get(address)
    const readSecond = loadOutputUniform(graph([node('i', 'oscIn'), node('o', 'output')], [['i.second', 'o.color']]), { osc: readOsc })
    const readOther = loadOutputUniform(graph([node('i', 'oscIn', { address: '/other' }), node('o', 'output')], [['i.value', 'o.color']]), { osc: readOsc })
    expect(readSecond()).toBe(0.75)
    expect(readOther()).toBe(0)
  })

  it('asks for its port; of two on different ports the first is opened and the other says so', () => {
    const one = createGlslCompiler().compile(graph([node('i', 'oscIn'), node('o', 'output')], [['i.value', 'o.color']]))
    const two = createGlslCompiler().compile(
      graph(
        [node('i', 'oscIn'), node('j', 'oscIn', { port: 9001 }), node('m', 'math'), node('o', 'output')],
        [
          ['i.value', 'm.a'],
          ['j.value', 'm.b'],
          ['m.result', 'o.color'],
        ],
      ),
    )
    expect(one.program!.resources.osc).toEqual([9000])
    expect(two.program!.resources.osc).toEqual([9000])
    expect(two.issues).toEqual([{ nodeId: 'j', message: 'Another OSC In listens on port 9000; one port is open at a time, so this one reads that port' }])
  })
})

describe('Knob', () => {
  it('keeps its value inside its range, whichever way round the range is given', () => {
    const readValue = (values: object) => loadOutputUniform(graph([node('k', 'knob', values as never), node('o', 'output')], [['k.value', 'o.color']]))()
    expect(readValue({ value: 5, min: 0, max: 2 })).toBe(2)
    expect(readValue({ value: -1, min: 2, max: 0 })).toBe(0)
    expect(readValue({ value: 0.3 })).toBeCloseTo(0.3)
  })
})
