import { describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { graph, node, renderGraph, tickGraph } from '@/lib/graph/testing'

async function renderReds(values: object, target: 'webgl' | 'cpp'): Promise<number[]> {
  const doc = graph(
    [node('uv', 'uv'), node('m', 'mapping', values as never), node('s', 'separateXYZ'), node('o', 'output')],
    [
      ['uv.uv', 'm.vector'],
      ['m.vector', 's.vector'],
      ['s.x', 'o.color'],
    ],
  )
  const leds = target === 'webgl' ? tickGraph(doc)[0] : (await renderGraph(doc)).leds
  return leds.map(([r]) => r)
}

const toCenterByte = (i: number, n = 8) => Math.round(((i + 0.5) / n) * 255)

const compiler = await commands.cppCompiler()

describe.for([
  ['webgl', ''],
  ['cpp', ' (needs g++ or c++ on PATH)'],
] as const)('Mapping through %s%s', ([target]) => {
  it.skipIf(target === 'cpp' && !compiler)('leaves coordinates alone at rest', async () => {
    expect(await renderReds({}, target)).toEqual([...Array(8).keys()].map((i) => toCenterByte(i)))
  })

  it.skipIf(target === 'cpp' && !compiler)('moves by Location, scales around the pivot, and turns by Rotation', async () => {
    expect((await renderReds({ location: [0.25, 0, 0] }, target)).slice(0, 4)).toEqual([0, 1, 2, 3].map((i) => Math.round(((i + 0.5) / 8 + 0.25) * 255)))
    expect(await renderReds({ scale: [2, 1, 1] }, target)).toEqual(
      [...Array(8).keys()].map((i) => Math.round(Math.min(1, Math.max(0, ((i + 0.5) / 8 - 0.5) * 2 + 0.5)) * 255)),
    )
    // Half a turn around center mirrors the strip
    expect(await renderReds({ rotation: 0.5 }, target)).toEqual([...Array(8).keys()].map((i) => toCenterByte(7 - i)))
  })
})

describe('Mapping', () => {
  it('Range Select is 1 between its bounds', async () => {
    const { leds } = await renderGraph(graph([node('r', 'rangeSelect', { from: 0.25, to: 0.5 }), node('o', 'output')], [['r.mask', 'o.color']]))
    expect(leds.map(([r]) => r)).toEqual([0, 0, 255, 255, 0, 0, 0, 0])
  })

  it('Mix blends and switches', async () => {
    const renderOne = async (values: object) =>
      (await renderGraph(graph([node('m', 'mix', values as never), node('o', 'output')], [['m.result', 'o.color']]), { leds: 1 })).leds[0][0]
    expect(await renderOne({ factor: 0.25, a: 0, b: 1 })).toBe(64)
    expect(await renderOne({ mode: 'switch', factor: 0.4, a: 0, b: 1 })).toBe(0)
    expect(await renderOne({ mode: 'switch', factor: 0.6, a: 0, b: 1 })).toBe(255)
    expect(await renderOne({ factor: 2, a: 0, b: 1, clampFactor: false })).toBe(255)
  }, 30_000)

  it('Hue/Saturation/Value and Separate/Combine Color agree with each other', async () => {
    const { leds } = await renderGraph(
      graph(
        [
          node('c', 'color', { color: [1, 0, 0] }),
          node('h', 'hueSaturation', { hue: 1 / 3 }),
          node('s', 'separateColor', { mode: 'hsv' }),
          node('k', 'combineColor', { mode: 'hsv' }),
          node('o', 'output'),
        ],
        [
          ['c.color', 'h.color'],
          ['h.color', 's.color'],
          ['s.a', 'k.a'],
          ['s.b', 'k.b'],
          ['s.c', 'k.c'],
          ['k.color', 'o.color'],
        ],
      ),
      { leds: 1 },
    )
    expect(leds[0]).toEqual([0, 255, 0])
  })
})
