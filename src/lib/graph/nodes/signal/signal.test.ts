import { describe, expect, it } from 'vitest'
import type { NodeItem } from '@/lib/graph/authoring'
import { generateGlsl } from '@/lib/graph'
import { graph, node } from '@/lib/graph/testing'
import { counterNode, toggleNode } from './counter'
import { curveNode } from './curve'
import { envelopeNode } from './envelope'
import { envelopeFollowerNode } from './envelope-follower'
import { mapRangeNode } from './map-range'
import { peakHoldNode } from './peak-hold'
import { sampleHoldNode } from './sample-hold'
import { schmittTriggerNode } from './schmitt-trigger'
import { slewLimiterNode } from './slew-limiter'

/** Runs a control node at a fixed frame rate; `input(t)` gives its inputs at time t. Returns one output per frame. */
function simulate(item: NodeItem, output: string, input: (t: number) => Record<string, unknown>, seconds: number, fps = 30): number[] {
  const { run, state: fresh } = item.base
  const state = fresh?.()
  return Array.from({ length: Math.round(seconds * fps) }, (_, frame) => {
    const time = (frame + 1) / fps
    return run!(input(time), state, { time, dt: 1 / fps, frameIndex: frame })[output] as number
  })
}

const last = (values: number[]) => values[values.length - 1]
/** The output on the frame that ends at time t; t must be a whole number of frames. */
const at = (values: number[], t: number, fps = 30) => values[Math.round(t * fps) - 1]

describe.each([30, 120])('at %i fps', (fps) => {
  it('envelope follower covers 63% of a step in its attack time, and of a drop in its release time', () => {
    const rise = simulate(envelopeFollowerNode, 'envelope', () => ({ signal: 1, attack: 0.2, release: 1 }), 0.2, fps)
    expect(last(rise)).toBeCloseTo(1 - 1 / Math.E, 2)
    const fall = simulate(envelopeFollowerNode, 'envelope', (t) => ({ signal: t < 0.5 ? 1 : 0, attack: 0, release: 0.4 }), 0.9, fps)
    expect(last(fall)).toBeCloseTo(1 / Math.E, 1)
  })

  it('peak hold keeps a peak for its hold time, then decays toward the signal', () => {
    const peak = simulate(peakHoldNode, 'peak', (t) => ({ signal: t < 0.1 ? 0.8 : 0.1, hold: 0.3, decay: 0.2 }), 1, fps)
    expect(at(peak, 0.3, fps)).toBe(0.8)
    expect(at(peak, 0.7, fps)).toBeLessThan(0.4)
    expect(last(peak)).toBeCloseTo(0.1, 1)
  })

  it('slew limiter moves at its rate, not faster', () => {
    const up = simulate(slewLimiterNode, 'value', () => ({ signal: 1, rise: 1, fall: 1 }), 0.5, fps)
    expect(last(up)).toBeCloseTo(0.5, 5)
    const down = simulate(slewLimiterNode, 'value', (t) => ({ signal: t < 1 ? 1 : 0, rise: 100, fall: 0.5 }), 2, fps)
    expect(last(down)).toBeCloseTo(0.5, 1)
  })

  it('envelope: ADSR holds at sustain while the gate is up and releases after; AD ignores the gate length', () => {
    const times = { attack: 0.1, decay: 0.2, sustain: 0.4, release: 0.5 }
    const adsr = simulate(envelopeNode, 'envelope', (t) => ({ mode: 'adsr', gate: t < 1 ? 1 : 0, ...times }), 2, fps)
    expect(Math.max(...adsr)).toBeCloseTo(1, 1)
    expect(at(adsr, 0.8, fps)).toBeCloseTo(0.4, 5)
    // the gate is already down on the frame ending at 1.0, so that frame is the first of the release
    expect(at(adsr, 1.1, fps)).toBeCloseTo(0.4 - (0.1 + 1 / fps) / 0.5, 5)
    expect(last(adsr)).toBe(0)

    const ad = simulate(envelopeNode, 'envelope', (t) => ({ mode: 'ad', gate: t < 1 ? 1 : 0, ...times }), 1, fps)
    expect(Math.max(...ad)).toBeCloseTo(1, 1)
    expect(at(ad, 0.5, fps)).toBe(0)
  })
})

describe('triggers', () => {
  it('threshold with hysteresis ignores a signal that wobbles between its two levels', () => {
    const wobble = (t: number) => 0.5 + 0.08 * Math.sin(t * 90)
    const gate = simulate(schmittTriggerNode, 'gate', (t) => ({ signal: t < 1 ? wobble(t) : t < 2 ? 0.9 : wobble(t), low: 0.4, high: 0.6 }), 3)
    const flips = gate.filter((g, i) => i > 0 && g !== gate[i - 1]).length
    expect(flips).toBe(1)
    expect(last(gate)).toBe(1)
  })

  it('sample and hold keeps the value it saw on the last rising trigger', () => {
    const held = simulate(sampleHoldNode, 'value', (t) => ({ signal: t, trigger: t % 1 < 0.2 ? 1 : 0 }), 2.5, 10)
    expect(at(held, 0.9, 10)).toBeCloseTo(0.1)
    expect(at(held, 1.5, 10)).toBeCloseTo(1.0)
    expect(at(held, 2.5, 10)).toBeCloseTo(2.0)
  })

  it('counter wraps at its step count and resets; toggle flips per trigger', () => {
    const pulse = (t: number) => (t % 0.5 < 0.2 ? 1 : 0)
    const count = simulate(counterNode, 'count', (t) => ({ steps: 3, trigger: pulse(t), reset: 0 }), 2.4, 10)
    expect([count[2], count[7], count[12], count[17], count[22]]).toEqual([1, 2, 0, 1, 2])
    const reset = simulate(counterNode, 'count', (t) => ({ steps: 8, trigger: pulse(t), reset: t > 1.25 ? 1 : 0 }), 1.4, 10)
    expect(last(reset)).toBe(0)
    const toggled = simulate(toggleNode, 'state', (t) => ({ trigger: pulse(t) }), 1.4, 10)
    expect([toggled[2], toggled[7], toggled[12]]).toEqual([1, 0, 1])
  })
})

describe('stateless nodes compute the same thing on both sides', () => {
  it('map range and curve', () => {
    expect(mapRangeNode.base.run!({ clamp: true, value: 3, inLow: 0, inHigh: 2, outLow: 10, outHigh: 20 }, undefined, { time: 0, dt: 0, frameIndex: 0 }).result).toBe(20)
    expect(mapRangeNode.base.run!({ clamp: false, value: 3, inLow: 0, inHigh: 2, outLow: 10, outHigh: 20 }, undefined, { time: 0, dt: 0, frameIndex: 0 }).result).toBe(25)
    expect(curveNode.base.run!({ curve: 'smooth', value: 0.5 }, undefined, { time: 0, dt: 0, frameIndex: 0 }).result).toBe(0.5)
  })
})

describe('what may feed a control-rate node', () => {
  it('a per-pixel link is refused with both node names in the message', () => {
    const result = generateGlsl(graph(
      [node('uv', 'uv'), node('env', 'envelopeFollower'), node('o', 'output')],
      [['uv.x', 'env.signal'], ['env.envelope', 'o.color']],
    ))
    expect(result.errorNode).toBe('env')
    expect(result.error).toBe('Signal needs one value per frame, but UV changes per pixel')
  })

  it('a per-pixel value that passes through a stateless node first is refused too', () => {
    const result = generateGlsl(graph(
      [node('uv', 'uv'), node('m', 'math'), node('env', 'envelopeFollower'), node('o', 'output')],
      [['uv.x', 'm.a'], ['m.result', 'env.signal'], ['env.envelope', 'o.color']],
    ))
    expect(result.error).toBe('Signal needs one value per frame, but Math changes per pixel')
  })

  it('knob -> curve -> envelope follower all run on the CPU, and only the envelope reaches the shader', () => {
    const { control, error } = generateGlsl(graph(
      [node('k', 'knob'), node('c', 'curve'), node('env', 'envelopeFollower'), node('o', 'output')],
      [['k.value', 'c.value'], ['c.result', 'env.signal'], ['env.envelope', 'o.color']],
    ))
    expect(error).toBeNull()
    expect(control.steps.map((s) => s.nodeId)).toEqual(['k', 'c', 'env'])
    expect(control.exports).toHaveLength(1)
  })
})
