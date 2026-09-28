import { describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { createGlslCompiler, findNodeItem } from '@/lib/graph'
import { graph, node, renderGraph } from '@/lib/graph/testing'
import { waveNode } from './wave'

const compiler = await commands.cppCompiler()

/** RGB bytes of one LED per frame through the usermod unit */
async function runFrames(doc: ReturnType<typeof graph>, frames: number, feed: { bands: number[][] }[] = []): Promise<number[][]> {
  const { program, issues } = await renderGraph(doc, { leds: 1 })
  expect(issues).toEqual([])
  return (await commands.runUsermod(program!.code, { leds: 1, frames, feed })).map(([rgb]) => rgb)
}

describe('Wave', () => {
  it('shapes its sockets: duty only for square, width only for pulse', () => {
    expect(waveNode.shape({ shape: 'square' }).inputs.map((s) => s.name)).toContain('duty')
    expect(waveNode.shape({ shape: 'sine' }).inputs.map((s) => s.name)).not.toContain('duty')
    expect(waveNode.shape({ shape: 'pulse' }).inputs.map((s) => s.name)).toContain('width')
  })

  it.skipIf(!compiler).each(['sine', 'triangle', 'saw', 'square', 'bounce', 'pulse'])('%s stays within 0..1 and has its period (needs g++ or c++ on PATH)', async (shape) => {
    // uv.x over 100 LEDs, two cycles, scaled into 0.25..0.75 so a value outside 0..1 shows past the clamp
    const { leds, issues } = await renderGraph(graph(
      [node('uv', 'uv'), node('w', 'wave', { shape, frequency: 2, phase: 0, duty: 0.5, width: 0.1 }), node('m', 'math', { op: 'multiplyAdd', b: 0.5, c: 0.25 }), node('o', 'output')],
      [['uv.x', 'w.input'], ['w.value', 'm.a'], ['m.result', 'o.color']],
    ), { leds: 100 })
    expect(issues).toEqual([])
    const reds = leds.map(([r]) => r)
    expect(Math.min(...reds)).toBeGreaterThanOrEqual(63)
    expect(Math.max(...reds)).toBeLessThanOrEqual(192)
    reds.slice(0, 50).forEach((red, i) => expect(Math.abs(red - reds[i + 50]), `LED ${i} and ${i + 50}`).toBeLessThanOrEqual(1))
  }, 30_000)

  it.skipIf(!compiler)('once per frame an unlinked Input follows the engine clock (needs g++ or c++ on PATH)', async () => {
    const doc = graph([node('w', 'wave', { shape: 'saw', frequency: 1 }), node('e', 'envelopeFollower', { attack: 0, release: 0 }), node('o', 'output')], [['w.value', 'e.signal'], ['e.envelope', 'o.color']])
    expect(createGlslCompiler().compile(doc).program!.frame).not.toBeNull()
    // Frame 6 = 0.2 s
    expect((await renderGraph(doc, { leds: 1, frames: 7 })).leds[0][0]).toBe(51)
  })

  it('unlinked it reads iTime, in the frame pass when a frame node reads it', () => {
    const { program } = createGlslCompiler().compile(graph([node('w', 'wave'), node('e', 'envelopeFollower'), node('o', 'output')], [['w.value', 'e.signal'], ['e.envelope', 'o.color']]))
    expect(program!.frame!.code).toContain('iTime * 1.0 + 0.0')
  })
})

describe.skipIf(!compiler)('Clock Divider (needs g++ or c++ on PATH)', () => {
  it('passes every fourth trigger and counts the phase between', async () => {
    // One-frame trigger every fifth frame from the first: phase 0.05 there, at least 0.25 elsewhere
    const frames = await runFrames(graph(
      [node('t', 'wave', { shape: 'square', frequency: 6, phase: 0.05, duty: 0.1 }), node('n', 'clockDivider', { divide: 4 }), node('c', 'combineXYZ'), node('o', 'output')],
      [['t.value', 'n.trigger'], ['n.trigger', 'c.x'], ['n.phase', 'c.y'], ['c.vector', 'o.color']],
    ), 50)
    expect(frames.flatMap(([trigger], i) => (trigger ? [i] : []))).toEqual([0, 20, 40])
    expect(frames[7][1]).toBe(128)
  }, 30_000)
})

describe('Bands', () => {
  it('has as many outputs as asked', () => {
    const bands = findNodeItem('bands')!
    expect(bands.shape({ count: '4' }).outputs.map((o) => o.label)).toEqual(['Band 1', 'Band 2', 'Band 3', 'Band 4'])
    expect(bands.shape({}).outputs).toHaveLength(8)
  })

  it.skipIf(!compiler)('folds the analysis bands into them, each the loudest it covers (needs g++ or c++ on PATH)', async () => {
    const row = Array.from({ length: 16 }, (_, i) => i / 15)
    const [[first, last]] = await runFrames(graph(
      [node('b', 'bands', { count: '4' }), node('c', 'combineXYZ'), node('o', 'output')],
      [['b.band1', 'c.x'], ['b.band4', 'c.y'], ['c.vector', 'o.color']],
    ), 1, [{ bands: [row] }])
    expect(first).toBe(51)
    expect(last).toBe(255)
  })
})
