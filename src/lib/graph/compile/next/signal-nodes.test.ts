import { describe, expect, it } from 'vitest'
import type { NodeGraph, SocketValue, StoredNode } from '@/lib/graph/model/doc'
import { nodeItem, valueInputs } from '@/lib/graph/registry'
import { alone, graph, initialState, node, toByte } from '@/lib/graph/testing'
import { cppCompiler, runUsermod } from '@/lib/graph/testing/cpp'
import { FPS } from '@/lib/graph/testing/offline'
import { generateGlsl } from '@/lib/graph/compile/compile'
import { FrameRunner } from '@/lib/graph/compile/js/frame'
import { glslCompiler, usermodCompiler } from './compilers'

const KINDS = ['envelope', 'schmittTrigger', 'counter', 'sampleHold', 'clockDivider', 'stepSequencer', 'slewLimiter', 'envelopeFollower', 'peakHold', 'integrator']
const FRAMES = 30

/** Nodes that drive one input of the kind under test, and the output that carries it. */
interface Driver {
  nodes: StoredNode[]
  links: [string, string][]
  out: string
}

// frame i is at time i / 30, so every threshold sits half a frame from a sample and float and double agree on it
/** 1 while the time is at most `duty`, then 0: a square wave of one cycle a second. */
const gate = (id: string, duty: number): Driver => ({ nodes: [node(id, 'wave', { shape: 'square', duty })], links: [], out: `${id}.value` })
/** 1 once the time reaches `from`. */
const after = (id: string, from: number): Driver =>
  ({ nodes: [node(`${id}t`, 'time'), node(id, 'math', { op: 'greaterThan', b: from })], links: [[`${id}t.time`, `${id}.a`]], out: `${id}.result` })
/** `a * scale + offset`, `a` another driver. */
const scaled = (id: string, a: Driver, scale: number, offset: number): Driver =>
  ({ nodes: [...a.nodes, node(id, 'math', { op: 'multiplyAdd', b: scale, c: offset })], links: [...a.links, [a.out, `${id}.a`]], out: `${id}.result` })
/** A one-frame trigger on frames 3, 9, 15, 21 and 27. */
const TRIGGERS: Driver = { nodes: [node('tr', 'wave', { shape: 'square', frequency: 5, phase: 0.5833, duty: 0.2 })], links: [], out: 'tr.value' }
const TIME: Driver = { nodes: [node('ti', 'time')], links: [], out: 'ti.time' }

/** Node `n` of `kind` with `values`, `drivers` into its inputs and `output` on the Output's color. */
function kindGraph(kind: string, output: string, values: Record<string, SocketValue>, drivers: Record<string, Driver> = {}): NodeGraph {
  const feeds = Object.entries(drivers)
  return graph(
    [...feeds.flatMap(([, d]) => d.nodes), node('n', kind, values), node('o', 'output')],
    [...feeds.flatMap(([socket, d]) => [...d.links, [d.out, `n.${socket}`] as [string, string]]), [`n.${output}`, 'o.color']],
  )
}

/** The red byte of the one LED on each of 30 frames, through the usermod target. */
function rendered(doc: NodeGraph): number[] {
  const { program, issues } = usermodCompiler(1).compile(doc)
  expect(issues).toEqual([])
  return runUsermod(program!.code, { leds: 1, frames: FRAMES }).map(([[red]]) => red)
}

/** What node `n`'s frame body put on `output` on each of the same frames, through the old pipeline's frame runner. */
function framed(doc: NodeGraph, output: string): number[] {
  const { frame: plan, error } = generateGlsl(doc)
  expect(error).toBeNull()
  const runner = new FrameRunner()
  runner.load(plan)
  return Array.from({ length: FRAMES }, (_, i) => {
    runner.step({ time: i / FPS, dt: 1 / FPS, frameIndex: i, audio: undefined, midi: undefined, osc: undefined })
    return runner.output('n', output) as number
  })
}

/** Renders the graph through the body and checks every frame against the frame body; returns the frame body's values. */
function sameAsFrameBody(doc: NodeGraph, output: string): number[] {
  const values = framed(doc, output)
  expectSameBytes(rendered(doc), values.map(toByte))
  return values
}

/** A value on half a byte rounds either way in float and in double, so a byte may be one off; a missed step is more. */
function expectSameBytes(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length)
  expect(Math.max(...actual.map((byte, i) => Math.abs(byte - expected[i])))).toBeLessThanOrEqual(1)
}

/** The kind alone, `uv.x` into its first number input. */
function fedFromUv(kind: string): NodeGraph {
  const doc = alone(nodeItem(kind)!)
  const [input] = valueInputs(nodeItem(kind)!.base)
  return { ...doc, nodes: [...doc.nodes, node('uv', 'uv')], edges: [...doc.edges, ...graph([], [['uv.x', `n.${input.name}`]]).edges] }
}

describe('each stateful signal kind has a body the new compiler places by what feeds it', () => {
  // the state annotation puts a node's slots in global state in the frame pass and in pixel state in the pixel pass
  it.each(KINDS)('%s alone runs in the frame pass; fed from uv.x, in the pixel pass', (kind) => {
    const framePass = glslCompiler().compile(alone(nodeItem(kind)!))
    expect(framePass.program!.frame).not.toBeNull()
    expect(Object.keys(framePass.slots.global)).toContain('n')
    expect(framePass.slots.pixel).toEqual({})
    const pixelPass = glslCompiler().compile(fedFromUv(kind))
    expect(pixelPass.program!.frame).toBeNull()
    expect(Object.keys(pixelPass.slots.pixel)).toEqual(['n'])
  })
})

describe.skipIf(!cppCompiler)('the bodies through the usermod target reproduce the frame bodies over 30 frames at 30 fps (needs g++ or c++ on PATH)', () => {
  it('envelope follower covers 63% of a step in its attack time, and of a drop in its release time', () => {
    const rise = sameAsFrameBody(kindGraph('envelopeFollower', 'envelope', { signal: 1, attack: 0.2, release: 1 }), 'envelope')
    expect(rise[5]).toBeCloseTo(1 - 1 / Math.E, 5)
    const fall = sameAsFrameBody(kindGraph('envelopeFollower', 'envelope', { attack: 0, release: 0.4 }, { signal: gate('g', 0.49) }), 'envelope')
    expect(fall[26]).toBeCloseTo(1 / Math.E, 5)
  })

  it('peak hold keeps a peak for its hold time, then decays toward the signal', () => {
    const peak = sameAsFrameBody(kindGraph('peakHold', 'peak', { hold: 0.32, decay: 0.2 }, { signal: scaled('s', gate('g', 0.09), 0.7, 0.1) }), 'peak')
    expect(peak[9]).toBeCloseTo(0.8, 5)
    expect(peak[21]).toBeLessThan(0.4)
    expect(peak[29]).toBeCloseTo(0.1, 5)
  })

  it('slew limiter moves at its rate, not faster', () => {
    const up = sameAsFrameBody(kindGraph('slewLimiter', 'value', { signal: 1, rise: 1, fall: 1 }), 'value')
    expect(up[14]).toBeCloseTo(0.5, 5)
    const down = sameAsFrameBody(kindGraph('slewLimiter', 'value', { rise: 100, fall: 0.5 }, { signal: gate('g', 0.49) }), 'value')
    expect(down[29]).toBeCloseTo(0.75, 5)
  })

  it('envelope: ADSR holds at sustain while the gate is up and releases after; AD ignores the gate length', () => {
    const times = { attack: 0.11, decay: 0.2, sustain: 0.4, release: 0.5 }
    const adsr = sameAsFrameBody(kindGraph('envelope', 'envelope', { mode: 'adsr', ...times }, { gate: gate('g', 0.59) }), 'envelope')
    expect(Math.max(...adsr)).toBe(1)
    expect(adsr[12]).toBeCloseTo(0.4, 5)
    // the gate is down from the frame at 0.6 on, so that frame is the first of the release
    expect(adsr[20]).toBeCloseTo(0.4 - 3 / FPS / 0.5, 5)
    expect(adsr[29]).toBe(0)
    const ad = sameAsFrameBody(kindGraph('envelope', 'envelope', { mode: 'ad', ...times }, { gate: gate('g', 0.59) }), 'envelope')
    expect(Math.max(...ad)).toBe(1)
    expect(ad[15]).toBe(0)
  })

  it('threshold with hysteresis ignores a signal that wobbles between its two levels', () => {
    const wobble: Driver = { nodes: [node('w', 'wave', { frequency: 14.3 })], links: [], out: 'w.value' }
    const signal = scaled('s', wobble, 0.16, 0.42)
    const late = after('a', 0.49)
    const lifted: Driver = { nodes: [...signal.nodes, ...late.nodes, node('l', 'math', { op: 'multiplyAdd', b: 0.4 })], links: [...signal.links, ...late.links, [late.out, 'l.a'], [signal.out, 'l.c']], out: 'l.result' }
    const gateOut = sameAsFrameBody(kindGraph('schmittTrigger', 'gate', { low: 0.4, high: 0.6 }, { signal: lifted }), 'gate')
    expect(gateOut.filter((g, i) => i > 0 && g !== gateOut[i - 1])).toHaveLength(1)
    expect(gateOut[29]).toBe(1)
  })

  it('sample and hold keeps the value it saw on the last rising trigger', () => {
    const held = sameAsFrameBody(kindGraph('sampleHold', 'value', {}, { signal: TIME, trigger: TRIGGERS }), 'value')
    expect([held[2], held[8], held[14], held[20], held[26], held[29]]).toEqual([0, 3, 9, 15, 21, 27].map((frame) => expect.closeTo(frame / FPS, 5)))
  })

  it('counter wraps at its step count and resets', () => {
    const phase = sameAsFrameBody(kindGraph('counter', 'phase', { steps: 3 }, { trigger: TRIGGERS }), 'phase')
    expect([phase[5], phase[11], phase[17], phase[23], phase[29]].map((p) => Math.round(p * 3))).toEqual([1, 2, 0, 1, 2])
    // the trigger's edge is taken before Reset's, so the count starts over from the reset on frame 24
    const reset = sameAsFrameBody(kindGraph('counter', 'phase', { steps: 8 }, { trigger: TRIGGERS, reset: after('r', 0.79) }), 'phase')
    expect([reset[23], reset[24], reset[29]]).toEqual([4 / 8, 0, 1 / 8])
  })

  it('clock divider passes every fourth trigger', () => {
    const fired = sameAsFrameBody(kindGraph('clockDivider', 'trigger', { divide: 4 }, { trigger: TRIGGERS }), 'trigger')
    expect(fired.flatMap((value, frame) => (value ? [frame] : []))).toEqual([3, 27])
  })

  it('step sequencer steps through its list on triggers and wraps; an empty list puts out 0', () => {
    const values = sameAsFrameBody(kindGraph('stepSequencer', 'value', { steps: '1 0 0.5' }, { trigger: TRIGGERS }), 'value')
    expect([values[0], values[5], values[11], values[17], values[23], values[29]]).toEqual([1, 0, 0.5, 1, 0, 0.5])
    expect(sameAsFrameBody(kindGraph('stepSequencer', 'value', { steps: '' }, { trigger: TRIGGERS }), 'value')).toEqual(new Array(FRAMES).fill(0))
  })

  it('integrator accumulates rate times dt, wraps, and resets', () => {
    const phase = sameAsFrameBody(kindGraph('integrator', 'value', { wrap: true }, { rate: scaled('s', after('a', 0.49), 2.5, 0.5), reset: after('r', 0.79) }), 'value')
    expect(phase[14]).toBeCloseTo(0.25, 5)
    // the rate change speeds it up without a jump: the next step is one frame of the new rate further
    expect(phase[15] - phase[14]).toBeCloseTo(3 / FPS, 5)
    expect(phase[22]).toBeCloseTo(0.05, 5)
    expect(phase[24]).toBeCloseTo(3 / FPS, 5)
  })

  it.each(KINDS)('%s fed from uv.x steps each LED as the frame body does with that LED\'s uv.x', (kind) => {
    const [input] = valueInputs(nodeItem(kind)!.base)
    const leds = 4
    const expected = Array.from({ length: leds }, (_, led) => perFrame(kind, { [input.name]: (led + 0.5) / leds }))
    const bytes = runUsermod(usermodCompiler(leds).compile(fedFromUv(kind)).program!.code, { leds, frames: FRAMES })
    expectSameBytes(bytes.flatMap((frame) => frame.map(([red]) => red)), Array.from({ length: FRAMES }, (_, frame) => expected.map((values) => toByte(values[frame]))).flat())
  })
})

/** The frame body of `kind` alone, its inputs at their defaults but `fixed`: its first output on each of 30 frames. */
function perFrame(kind: string, fixed: Record<string, number>): number[] {
  const shape = nodeItem(kind)!.base
  const input = { ...Object.fromEntries(shape.inputs.map((socket) => [socket.name, socket.default])), ...fixed }
  const state = initialState(shape.state!)
  const resolved = shape.resolve?.(input, {}).data ?? {}
  return Array.from({ length: FRAMES }, (_, i) =>
    shape.frame!(input, { time: i / FPS, dt: 1 / FPS, frameIndex: i, audio: undefined, midi: undefined, osc: undefined, state, resolved })[shape.outputs[0].name] as number)
}
