import { describe, expect, it } from 'vitest'
import type { NodeItem } from '@/lib/graph/authoring'
import { FrameRunner, generateGlsl, nodeItem } from '@/lib/graph'
import { graph, initialState, node } from '@/lib/graph/testing'
import { clockDividerNode } from './clock-divider'
import { integratorNode } from './integrator'
import { stepSequencerNode } from './step-sequencer'
import { waveNode } from './wave'

const frame = (n: number, fps = 30, state?: unknown, resolved = {}) => ({ time: n / fps, dt: 1 / fps, frameIndex: n, audio: undefined, midi: undefined, osc: undefined, state, resolved })

function simulate(item: NodeItem, values: Record<string, unknown>, output: string, input: (t: number) => Record<string, unknown>, seconds: number, fps = 30): number[] {
  const shape = item.shape(values)
  const state = shape.state && initialState(shape.state)
  const resolved = shape.resolve?.(values, {}).data
  return Array.from({ length: Math.round(seconds * fps) }, (_, n) => shape.frame!({ ...values, ...input((n + 1) / fps) }, frame(n + 1, fps, state, resolved))[output] as number)
}

describe('Wave', () => {
  it('shapes its sockets: duty only for square, width only for pulse', () => {
    expect(waveNode.shape({ shape: 'square' }).inputs.map((s) => s.name)).toContain('duty')
    expect(waveNode.shape({ shape: 'sine' }).inputs.map((s) => s.name)).not.toContain('duty')
    expect(waveNode.shape({ shape: 'pulse' }).inputs.map((s) => s.name)).toContain('width')
  })

  it.each(['sine', 'triangle', 'saw', 'square', 'bounce', 'pulse'])('%s stays within 0..1 and has its period', (shape) => {
    const run = (input: number) => waveNode.shape({ shape }).frame!({ shape, input, frequency: 2, phase: 0, duty: 0.5, width: 0.1 }, frame(0)).value as number
    const samples = Array.from({ length: 200 }, (_, i) => run(i / 100))
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...samples)).toBeLessThanOrEqual(1)
    expect(run(0.3)).toBeCloseTo(run(0.8), 6)
  })

  it('per frame an unlinked Input follows the engine clock', () => {
    const { frame: plan, error } = generateGlsl(graph([node('w', 'wave', { shape: 'saw', frequency: 1 }), node('e', 'envelopeFollower', { attack: 0, release: 0 }), node('o', 'output')], [['w.value', 'e.signal'], ['e.envelope', 'o.color']]))
    expect(error).toBeNull()
    const runner = new FrameRunner()
    runner.load(plan)
    expect(runner.step({ time: 0.25, dt: 1 / 30, frameIndex: 1, audio: undefined, midi: undefined, osc: undefined })[0]).toBeCloseTo(0.25, 5)
  })

  it('in the shader it uses iTime by default', () => {
    expect(generateGlsl(graph([node('w', 'wave'), node('o', 'output')], [['w.value', 'o.color']])).code).toContain('iTime * 1.0 + 0.0')
  })
})

describe('Integrator', () => {
  it('accumulates rate times dt, wraps, and resets', () => {
    // frames end at t = 1/30, 2/30, ...; the rate changes after the frame ending at 1.0 and the reset lands on the frame after 1.5
    const phase = simulate(integratorNode, { wrap: true }, 'value', (t) => ({ rate: t <= 1 ? 0.5 : 2, reset: t > 1.5 ? 1 : 0 }), 2)
    expect(phase[29]).toBeCloseTo(0.5, 5)
    // the rate change speeds it up without a jump: the next step is one frame of the new rate further
    expect(phase[30] - phase[29]).toBeCloseTo(2 / 30, 5)
    expect(phase[44]).toBeLessThan(1)
    expect(phase[45]).toBeCloseTo(2 / 30, 5)
  })
})

describe('Clock Divider', () => {
  it('passes every fourth trigger and counts the phase between', () => {
    // a trigger on every fifth frame, starting with the first
    const shape = clockDividerNode.shape({})
    const state = initialState(shape.state!)
    const out = Array.from({ length: 50 }, (_, n) => shape.frame!({ divide: 4, trigger: n % 5 === 0 ? 1 : 0, reset: 0 }, frame(n + 1, 10, state)))
    const fired = out.map((o, i) => (o.trigger ? i : -1)).filter((i) => i >= 0)
    expect(fired).toEqual([0, 20, 40])
    expect(out[7].phase).toBe(0.5)
  })
})

describe('Step Sequencer', () => {
  it('steps through its list on triggers and wraps', () => {
    // triggers on frames 5, 10, 15, ... (t = 0.5, 1.0, ...); before the first one the first value shows
    const values = simulate(stepSequencerNode, { steps: '1 0 0.5' }, 'value', (t) => ({ trigger: Math.round(t * 10) % 5 === 0 ? 1 : 0, reset: 0 }), 2, 10)
    expect(values[0]).toBe(1)
    expect([values[4], values[9], values[14], values[19]]).toEqual([0, 0.5, 1, 0])
    expect(simulate(stepSequencerNode, { steps: '' }, 'value', () => ({ trigger: 0, reset: 0 }), 0.5, 10)[0]).toBe(0)
  })
})

describe('Bands', () => {
  it('has as many outputs as asked and folds the analysis bands into them', () => {
    const bands = nodeItem('bands')!
    expect(bands.shape({ count: '4' }).outputs.map((o) => o.label)).toEqual(['Band 1', 'Band 2', 'Band 3', 'Band 4'])
    expect(bands.shape({}).outputs).toHaveLength(8)
    const features = { bands: Float32Array.from({ length: 16 }, (_, i) => i / 15) }
    const out = bands.shape({ count: '4' }).frame!({ spectrum: null, count: '4' }, { ...frame(0), audio: { analyses: [features as never], sampleRate: 48000 } })
    expect(out.band1).toBeCloseTo(3 / 15)
    expect(out.band4).toBeCloseTo(1)
  })
})
