import { describe, expect, it } from 'vitest'
import type { NodeGraph, SocketValue, StoredNode } from '@/lib/graph/model/doc'
import { findNodeItem, listValueInputs } from '@/lib/graph/registry'
import { placeAlone, graph, node } from '@/lib/graph/testing'
import { cppCompiler, runUsermod } from '@/lib/graph/testing/cpp'
import { FPS } from '@/lib/graph/testing/offline'
import { createGlslCompiler, createUsermodCompiler } from '@/lib/graph/compile/compilers'

const KINDS = ['envelope', 'schmittTrigger', 'counter', 'toggle', 'sampleHold', 'clockDivider', 'stepSequencer', 'slewLimiter', 'envelopeFollower', 'peakHold', 'integrator']
const FRAMES = 30

/** Nodes driving one input of the kind under test, and the carrying output */
interface Driver {
  nodes: StoredNode[]
  links: [string, string][]
  out: string
}

// Frame i at i / 30: thresholds sit half a frame from a sample, so float and double agree
/** 1 while time <= `duty`, then 0: square wave, one cycle a second */
const driveGate = (id: string, duty: number): Driver => ({ nodes: [node(id, 'wave', { shape: 'square', duty })], links: [], out: `${id}.value` })
const driveAfter = (id: string, from: number): Driver =>
  ({ nodes: [node(`${id}t`, 'time'), node(id, 'math', { op: 'greaterThan', b: from })], links: [[`${id}t.time`, `${id}.a`]], out: `${id}.result` })
const driveScaled = (id: string, a: Driver, scale: number, offset: number): Driver =>
  ({ nodes: [...a.nodes, node(id, 'math', { op: 'multiplyAdd', b: scale, c: offset })], links: [...a.links, [a.out, `${id}.a`]], out: `${id}.result` })
/** One-frame trigger on frames 3, 9, 15, 21, 27 */
const TRIGGERS: Driver = { nodes: [node('tr', 'wave', { shape: 'square', frequency: 5, phase: 0.5833, duty: 0.2 })], links: [], out: 'tr.value' }
const TIME: Driver = { nodes: [node('ti', 'time')], links: [], out: 'ti.time' }

/** Node `n` w/ `drivers` into its inputs and `output` on the Output's color */
function buildKindGraph(kind: string, output: string, values: Record<string, SocketValue>, drivers: Record<string, Driver> = {}): NodeGraph {
  const feeds = Object.entries(drivers)
  return graph(
    [...feeds.flatMap(([, d]) => d.nodes), node('n', kind, values), node('o', 'output')],
    [...feeds.flatMap(([socket, d]) => [...d.links, [d.out, `n.${socket}`] as [string, string]]), [`n.${output}`, 'o.color']],
  )
}

/** Red byte of the one LED over 30 frames via the usermod target */
function renderRed(doc: NodeGraph): number[] {
  const { program, issues } = createUsermodCompiler(1).compile(doc)
  expect(issues).toEqual([])
  return runUsermod(program!.code, { leds: 1, frames: FRAMES }).map(([[red]]) => red)
}

/** What `n` puts on the Output over 30 frames, 0 to 1; LED bytes step by 1/255, so toBeCloseTo 2 is the finest check */
const renderValues = (doc: NodeGraph) => renderRed(doc).map((byte) => byte / 255)

/** Half-byte values round either way in float vs double, so one byte off is fine; a missed step is more */
function expectSameBytes(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length)
  expect(Math.max(...actual.map((byte, i) => Math.abs(byte - expected[i])))).toBeLessThanOrEqual(1)
}

/** `uv.x` into the kind's first number input */
function feedFromUv(kind: string): NodeGraph {
  const doc = placeAlone(findNodeItem(kind)!)
  const [input] = listValueInputs(findNodeItem(kind)!.base)
  return { ...doc, nodes: [...doc.nodes, node('uv', 'uv')], edges: [...doc.edges, ...graph([], [['uv.x', `n.${input.name}`]]).edges] }
}

describe('each stateful signal kind has a body the new compiler places by what feeds it', () => {
  // Frame pass slots in global state, pixel pass slots in pixel state
  it.each(KINDS)('%s alone runs in the frame pass; fed from uv.x, in the pixel pass', (kind) => {
    const framePass = createGlslCompiler().compile(placeAlone(findNodeItem(kind)!))
    expect(framePass.program!.frame).not.toBeNull()
    expect(Object.keys(framePass.slots.global)).toContain('n')
    expect(framePass.slots.pixel).toEqual({})
    const pixelPass = createGlslCompiler().compile(feedFromUv(kind))
    expect(pixelPass.program!.frame).toBeNull()
    expect(Object.keys(pixelPass.slots.pixel)).toEqual(['n'])
  })
})

describe.skipIf(!cppCompiler)('the bodies through the usermod target over 30 frames at 30 fps (needs g++ or c++ on PATH)', () => {
  it('envelope follower covers 63% of a step in its attack time, and of a drop in its release time', () => {
    const rise = renderValues(buildKindGraph('envelopeFollower', 'envelope', { signal: 1, attack: 0.2, release: 1 }))
    expect(rise[5]).toBeCloseTo(1 - 1 / Math.E, 2)
    const fall = renderValues(buildKindGraph('envelopeFollower', 'envelope', { attack: 0, release: 0.4 }, { signal: driveGate('g', 0.49) }))
    expect(fall[26]).toBeCloseTo(1 / Math.E, 2)
  })

  it('peak hold keeps a peak for its hold time, then decays toward the signal', () => {
    const peak = renderValues(buildKindGraph('peakHold', 'peak', { hold: 0.32, decay: 0.2 }, { signal: driveScaled('s', driveGate('g', 0.09), 0.7, 0.1) }))
    expect(peak[9]).toBeCloseTo(0.8, 2)
    expect(peak[21]).toBeLessThan(0.4)
    expect(peak[29]).toBeCloseTo(0.1, 2)
  })

  it('slew limiter moves at its rate, not faster', () => {
    const up = renderValues(buildKindGraph('slewLimiter', 'value', { signal: 1, rise: 1, fall: 1 }))
    expect(up[14]).toBeCloseTo(0.5, 2)
    const down = renderValues(buildKindGraph('slewLimiter', 'value', { rise: 100, fall: 0.5 }, { signal: driveGate('g', 0.49) }))
    expect(down[29]).toBeCloseTo(0.75, 2)
  })

  it('envelope: ADSR holds at sustain while the gate is up and releases after; AD ignores the gate length', () => {
    const times = { attack: 0.11, decay: 0.2, sustain: 0.4, release: 0.5 }
    const adsr = renderValues(buildKindGraph('envelope', 'envelope', { mode: 'adsr', ...times }, { gate: driveGate('g', 0.59) }))
    expect(Math.max(...adsr)).toBe(1)
    expect(adsr[12]).toBeCloseTo(0.4, 2)
    // Gate down from 0.6 on, so that frame starts the release
    expect(adsr[20]).toBeCloseTo(0.4 - 3 / FPS / 0.5, 2)
    expect(adsr[29]).toBe(0)
    const ad = renderValues(buildKindGraph('envelope', 'envelope', { mode: 'ad', ...times }, { gate: driveGate('g', 0.59) }))
    expect(Math.max(...ad)).toBe(1)
    expect(ad[15]).toBe(0)
  })

  it('threshold with hysteresis ignores a signal that wobbles between its two levels', () => {
    const wobble: Driver = { nodes: [node('w', 'wave', { frequency: 14.3 })], links: [], out: 'w.value' }
    const signal = driveScaled('s', wobble, 0.16, 0.42)
    const late = driveAfter('a', 0.49)
    const lifted: Driver = { nodes: [...signal.nodes, ...late.nodes, node('l', 'math', { op: 'multiplyAdd', b: 0.4 })], links: [...signal.links, ...late.links, [late.out, 'l.a'], [signal.out, 'l.c']], out: 'l.result' }
    const gateOut = renderValues(buildKindGraph('schmittTrigger', 'gate', { low: 0.4, high: 0.6 }, { signal: lifted }))
    expect(gateOut.filter((g, i) => i > 0 && g !== gateOut[i - 1])).toHaveLength(1)
    expect(gateOut[29]).toBe(1)
  })

  it('sample and hold keeps the value it saw on the last rising trigger', () => {
    const held = renderValues(buildKindGraph('sampleHold', 'value', {}, { signal: TIME, trigger: TRIGGERS }))
    expect([held[2], held[8], held[14], held[20], held[26], held[29]]).toEqual([0, 3, 9, 15, 21, 27].map((frame) => expect.closeTo(frame / FPS, 2)))
  })

  it('counter wraps at its step count and resets', () => {
    const phase = renderValues(buildKindGraph('counter', 'phase', { steps: 3 }, { trigger: TRIGGERS }))
    expect([phase[5], phase[11], phase[17], phase[23], phase[29]].map((p) => Math.round(p * 3))).toEqual([1, 2, 0, 1, 2])
    // Trigger edge taken before Reset's, so the count restarts from the reset on frame 24
    const reset = renderValues(buildKindGraph('counter', 'phase', { steps: 8 }, { trigger: TRIGGERS, reset: driveAfter('r', 0.79) }))
    expect([reset[23], reset[24], reset[29]]).toEqual([4 / 8, 0, 1 / 8].map((value) => expect.closeTo(value, 2)))
  })

  it('toggle flips on every trigger', () => {
    const flips = renderValues(buildKindGraph('toggle', 'state', {}, { trigger: TRIGGERS }))
    expect([flips[2], flips[3], flips[9], flips[15], flips[29]]).toEqual([0, 1, 0, 1, 1])
  })

  it('clock divider passes every fourth trigger', () => {
    const fired = renderValues(buildKindGraph('clockDivider', 'trigger', { divide: 4 }, { trigger: TRIGGERS }))
    expect(fired.flatMap((value, frame) => (value ? [frame] : []))).toEqual([3, 27])
  })

  it('step sequencer steps through its list on triggers and wraps; an empty list puts out 0', () => {
    const values = renderValues(buildKindGraph('stepSequencer', 'value', { steps: '1 0 0.5' }, { trigger: TRIGGERS }))
    expect([values[0], values[5], values[11], values[17], values[23], values[29]]).toEqual([1, 0, 0.5, 1, 0, 0.5].map((value) => expect.closeTo(value, 2)))
    expect(renderValues(buildKindGraph('stepSequencer', 'value', { steps: '' }, { trigger: TRIGGERS }))).toEqual(new Array(FRAMES).fill(0))
  })

  it('integrator accumulates rate times dt, wraps, and resets', () => {
    const phase = renderValues(buildKindGraph('integrator', 'value', { wrap: true }, { rate: driveScaled('s', driveAfter('a', 0.49), 2.5, 0.5), reset: driveAfter('r', 0.79) }))
    expect(phase[14]).toBeCloseTo(0.25, 2)
    // Rate change w/o a jump: next step is one frame of the new rate
    expect(phase[15] - phase[14]).toBeCloseTo(3 / FPS, 2)
    expect(phase[22]).toBeCloseTo(0.05, 2)
    expect(phase[24]).toBeCloseTo(3 / FPS, 2)
  })

  it.each(KINDS)('%s fed from uv.x steps each LED as the kind alone does with that LED\'s uv.x stored', (kind) => {
    const [input] = listValueInputs(findNodeItem(kind)!.base)
    const leds = 4
    const fed = runUsermod(createUsermodCompiler(leds).compile(feedFromUv(kind)).program!.code, { leds, frames: FRAMES })
    for (let led = 0; led < leds; led++) {
      const stored = renderRed(buildKindGraph(kind, findNodeItem(kind)!.base.outputs[0].name, { [input.name]: (led + 0.5) / leds }))
      expectSameBytes(fed.map((frame) => frame[led][0]), stored)
    }
  })
})
