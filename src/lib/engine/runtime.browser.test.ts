import { afterEach, describe, expect, it } from 'vitest'
import { createGlslCompiler, type NodeGraph, type SocketValue } from '@/lib/graph'
import { AudioTextures } from '@/lib/audio/textures'
import { graph, node } from '@/lib/graph/testing'
import { ShaderRenderer, type FrameParams } from './render/renderer'
import { Runtime } from './runtime'

const floatTargets = !!document.createElement('canvas').getContext('webgl2')?.getExtension('EXT_color_buffer_float')
const DT = 1 / 30

let renderer: ShaderRenderer | null = null
afterEach(() => renderer?.dispose())

function startRuntime(canvas = document.createElement('canvas')) {
  renderer = new ShaderRenderer(canvas)
  const runtime = new Runtime(renderer)
  let frame = 0
  return {
    runtime,
    /** Against the running slot table, as the graph session compiles */
    load(doc: NodeGraph) {
      const { program, slots, issues } = createGlslCompiler().compile(doc, { slots: runtime.slots })
      expect(issues).toEqual([])
      runtime.load(program!, slots)
      return slots
    },
    tick(): Float32Array {
      const params: FrameParams = { time: frame * DT, dt: DT, frame, ledCount: 1, scanY: 0.5 }
      frame++
      return runtime.tick(params)
    },
  }
}

/** Frame node of `kind` read back by a Viewer */
const buildProbedGraph = (kind: string, values: Record<string, SocketValue>) =>
  graph([node('n', kind, values), node('v', 'viewer'), node('o', 'output')], [[`n.${OUTPUTS[kind]}`, 'v.value']])

const OUTPUTS: Record<string, string> = { envelopeFollower: 'envelope', peakHold: 'peak', slewLimiter: 'value' }

describe.skipIf(!floatTargets)('Runtime (needs EXT_color_buffer_float)', () => {
  it("keeps an envelope follower's value through a value edit that keeps the node", () => {
    const { runtime, load, tick } = startRuntime()
    const before = load(buildProbedGraph('envelopeFollower', { signal: 1, attack: 0.5, release: 0.3 }))
    for (let i = 0; i < 10; i++) tick()
    const reached = runtime.readProbe('v')!
    expect(reached).toBeCloseTo(1 - Math.exp((-10 * DT) / 0.5), 4)

    const after = load(buildProbedGraph('envelopeFollower', { signal: 1, attack: 0.5, release: 0.6 }))
    expect(after.global.n).toBe(before.global.n)
    tick()
    expect(runtime.readProbe('v')).toBeCloseTo(reached + (1 - reached) * (1 - Math.exp(-DT / 0.5)), 4)
  })

  it('integrates a knob turned mid-run: the knob a uniform, the integrator frame state the LEDs read', () => {
    const { runtime, load, tick } = startRuntime()
    load(
      graph(
        [node('k', 'knob', { value: 0.5 }), node('i', 'integrator', { wrap: false }), node('v', 'viewer'), node('o', 'output')],
        [
          ['k.value', 'i.rate'],
          ['i.value', 'v.value'],
          ['i.value', 'o.color'],
        ],
      ),
    )
    for (let i = 0; i < 10; i++) tick()
    expect(runtime.readProbe('v')).toBeCloseTo(10 * DT * 0.5, 4)
    runtime.set(runtime.uniforms[0], 1)
    for (let i = 0; i < 9; i++) tick()
    // Half-float LED target: about 3 decimals
    expect(tick()[0]).toBeCloseTo(10 * DT * 0.5 + 10 * DT, 2)
    expect(runtime.readProbe('v')).toBeCloseTo(10 * DT * 0.5 + 10 * DT, 4)
  })

  it('starts a node from 0 in global state floats another node left behind', () => {
    const { runtime, load, tick } = startRuntime()
    load(buildProbedGraph('envelopeFollower', { signal: 1, attack: 0.01 }))
    for (let i = 0; i < 5; i++) tick()
    expect(runtime.readProbe('v')).toBeCloseTo(1, 3)

    const slots = load(buildProbedGraph('peakHold', { signal: 0 }))
    expect(slots.global.n.value.offset).toBe(0)
    tick()
    expect(runtime.readProbe('v')).toBe(0)
  })

  it('starts a re-kinded node from 0 even when its slots have the same names and types', () => {
    const { runtime, load, tick } = startRuntime()
    load(buildProbedGraph('envelopeFollower', { signal: 1, attack: 0.01 }))
    for (let i = 0; i < 5; i++) tick()
    expect(runtime.readProbe('v')).toBeCloseTo(1, 3)

    load(buildProbedGraph('slewLimiter', { signal: 0 }))
    tick()
    expect(runtime.readProbe('v')).toBe(0)
  })

  it('edits the kinds of two per-pixel stateful nodes twelve times without running out of pixel state', () => {
    const { load, tick } = startRuntime()
    const kinds: Record<string, string> = { a: 'peakHold', b: 'sampleHold' }
    const buildDoc = () =>
      graph(
        [node('uv', 'uv'), node('a', kinds.a), node('b', kinds.b), node('m', 'math', { op: 'add' }), node('o', 'output')],
        [
          ['uv.x', 'a.signal'],
          ['uv.x', 'b.signal'],
          [`a.${kinds.a === 'peakHold' ? 'peak' : 'value'}`, 'm.a'],
          [`b.${kinds.b === 'peakHold' ? 'peak' : 'value'}`, 'm.b'],
          ['m.result', 'o.color'],
        ],
      )
    load(buildDoc())
    for (let edit = 0; edit < 12; edit++) {
      const id = edit % 2 === 0 ? 'a' : 'b'
      kinds[id] = kinds[id] === 'peakHold' ? 'sampleHold' : 'peakHold'
      const slots = load(buildDoc())
      expect(Math.max(...Object.values(slots.pixel).flatMap((entry) => Object.values(entry).map((slot) => slot.offset)))).toBe(3)
      tick()
    }
  })

  it('reset takes global state back to 0', () => {
    const { runtime, load, tick } = startRuntime()
    load(buildProbedGraph('envelopeFollower', { signal: 1, attack: 0.01 }))
    for (let i = 0; i < 5; i++) tick()
    runtime.reset()
    tick()
    expect(runtime.readProbe('v')).toBeCloseTo(1 - Math.exp(-DT / 0.01), 4)
  })

  it('draws a knob at its default until the host sets it, and MIDI In at the latest message', () => {
    const { runtime, load, tick } = startRuntime()
    load(
      graph(
        [node('k', 'knob', { value: 0.5 }), node('i', 'midiIn', { number: 7 }), node('c', 'combineXYZ'), node('o', 'output')],
        [
          ['k.value', 'c.x'],
          ['i.value', 'c.y'],
          ['c.vector', 'o.color'],
        ],
      ),
    )
    const readBytes = () => Array.from(tick(), (channel) => Math.round(channel * 255))
    expect(readBytes()).toEqual([128, 0, 0])
    const [knob] = runtime.uniforms
    runtime.set(knob, 0.25)
    runtime.readMidiAndOsc({ value: (kind, channel, number) => (kind === 'cc' && channel === 0 && number === 7 ? 1 : 0) }, () => undefined)
    expect(readBytes()).toEqual([64, 255, 0])
  })

  it('uploads the float spectra only for a program that reads them, a Band Split', () => {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')!
    let floatUploads = 0
    const texSubImage2D = gl.texSubImage2D.bind(gl) as (...args: unknown[]) => void
    ;(gl as unknown as Record<string, unknown>).texSubImage2D = (...args: unknown[]) => {
      if (args[7] === gl.FLOAT) floatUploads++
      texSubImage2D(...args)
    }
    const { runtime, load } = startRuntime(canvas)
    const textures = new AudioTextures(16)
    textures.push(new Float32Array(512), {
      spectrum: new Float32Array(512).fill(0.5),
      gain: 1,
      gate: true,
      waveform: new Float32Array(2048),
      bands: new Float32Array(16),
      chroma: new Float32Array(12),
    } as never)

    load(graph([node('a', 'audio'), node('o', 'output')], [['a.level', 'o.color']]))
    renderer!.setAudio(textures, [], null)
    expect(floatUploads).toBe(0)

    load(graph([node('b', 'bandSplit'), node('o', 'output')], [['b.level', 'o.color']]))
    renderer!.setAudio(textures, [], null)
    expect(floatUploads).toBe(1)
  })
})
