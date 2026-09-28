import { describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { createGlslCompiler } from '@/lib/graph'
import { graph, node, renderGraph } from '@/lib/graph/testing'
import { clockDividerNode } from './triggers/clock-divider'
import { counterNode, toggleNode } from './triggers/counter'
import { envelopeNode } from './triggers/envelope'
import { envelopeFollowerNode } from './smoothing/envelope-follower'
import { integratorNode } from './integrator'
import { peakHoldNode } from './smoothing/peak-hold'
import { sampleHoldNode } from './triggers/sample-hold'
import { schmittTriggerNode } from './triggers/schmitt-trigger'
import { slewLimiterNode } from './smoothing/slew-limiter'
import { stepSequencerNode } from './triggers/step-sequencer'

const compiler = await commands.cppCompiler()

// Every flag and stage a float slot; the sequencer's `values` come from `resolve`
it.each(([
  [counterNode, ['count', 'triggerHigh', 'resetHigh']],
  [toggleNode, ['on', 'high']],
  [clockDividerNode, ['count', 'triggerHigh', 'resetHigh']],
  [integratorNode, ['value', 'high']],
  [sampleHoldNode, ['held', 'high']],
  [envelopeNode, ['stage', 'level', 'high']],
  [envelopeFollowerNode, ['value']],
  [slewLimiterNode, ['value']],
  [peakHoldNode, ['value', 'held']],
  [schmittTriggerNode, ['on']],
  [stepSequencerNode, ['index', 'triggerHigh', 'resetHigh']],
] as const).map(([item, slots]) => [item.id, item, slots] as const))('%s keeps its state in these slots', (_, item, slots) => {
  expect(Object.keys(item.base.state!)).toEqual(slots)
})

describe.skipIf(!compiler)('stateless nodes (needs g++ or c++ on PATH)', () => {
  it('map range clamps when asked, and curve eases', async () => {
    const renderOne = async (kind: string, output: string, values: object) =>
      (await renderGraph(graph([node('n', kind, values as never), node('o', 'output')], [[`n.${output}`, 'o.color']]), { leds: 1 })).leds[0][0]
    expect(await renderOne('remap', 'result', { clamp: true, value: 3, inLow: 0, inHigh: 2, outLow: 0.1, outHigh: 0.2 })).toBe(51)
    expect(await renderOne('remap', 'result', { clamp: false, value: 3, inLow: 0, inHigh: 2, outLow: 0.1, outHigh: 0.2 })).toBe(64)
    expect(await renderOne('curve', 'result', { curve: 'smooth', value: 0.5 })).toBe(128)
  }, 30_000)
})

describe('what may feed a stateful node', () => {
  it('a per-pixel link runs it per pixel, with its state in pixel state', () => {
    const { program, slots, issues } = createGlslCompiler().compile(graph(
      [node('uv', 'uv'), node('env', 'envelopeFollower'), node('o', 'output')],
      [['uv.x', 'env.signal'], ['env.envelope', 'o.color']],
    ))
    expect(issues).toEqual([])
    expect(program!.frame).toBeNull()
    expect(Object.keys(slots.pixel)).toEqual(['env'])
  })

  it('a per-pixel value that passes through a stateless node first does the same', () => {
    const { program, slots, issues } = createGlslCompiler().compile(graph(
      [node('uv', 'uv'), node('m', 'math'), node('env', 'envelopeFollower'), node('o', 'output')],
      [['uv.x', 'm.a'], ['m.result', 'env.signal'], ['env.envelope', 'o.color']],
    ))
    expect(issues).toEqual([])
    expect(program!.frame).toBeNull()
    expect(Object.keys(slots.pixel)).toEqual(['env'])
  })

  it('knob -> curve -> envelope follower run once per frame, and only the envelope reaches the pixel pass', () => {
    const { program, slots, issues } = createGlslCompiler().compile(graph(
      [node('k', 'knob'), node('c', 'curve'), node('env', 'envelopeFollower'), node('o', 'output')],
      [['k.value', 'c.value'], ['c.result', 'env.signal'], ['env.envelope', 'o.color']],
    ))
    expect(issues).toEqual([])
    expect(program!.lineNodes.frame.filter((id) => id !== null)).toEqual(expect.arrayContaining(['c', 'env']))
    expect(new Set(program!.lineNodes.pixel.filter((id) => id !== null))).toEqual(new Set(['o']))
    expect(program!.pixel).toContain('texelFetch(iGlobal')
    expect(Object.keys(slots.global)).toEqual(['env', 'env:envelope'])
    expect(program!.uniforms.map((uniform) => uniform.node)).toEqual(['k'])
  })
})
