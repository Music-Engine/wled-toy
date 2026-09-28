import { describe, expect, it } from 'vitest'
import { graph, node, renderGraph } from '@/lib/graph/testing'

const renderFactors = async (values: object, location: [number, number, number]) => (await renderGraph(graph(
  [node('m', 'mapping', { location }), node('n', 'noiseTexture', { scale: 5, ...values }), node('o', 'output')],
  [['m.vector', 'n.vector'], ['n.fac', 'o.color']],
), { leds: 16 })).leds.map((led) => led[0])

const isVaried = (leds: number[]) => new Set(leds).size > 4

describe('Noise Texture', () => {
  it('fac spans both sides of 0.5', async () => {
    const leds = await renderFactors({}, [0, 0, 0])
    expect(Math.min(...leds)).toBeLessThan(100)
    expect(Math.max(...leds)).toBeGreaterThan(156)
  })

  it('varies at negative coordinates and with distortion, instead of one flat value', async () => {
    expect(isVaried(await renderFactors({}, [-2, -2, 0]))).toBe(true)
    expect(isVaried(await renderFactors({ distortion: 1 }, [0, 0, 0]))).toBe(true)
    expect(isVaried(await renderFactors({ distortion: 1 }, [-0.5, 0.2, 0]))).toBe(true)
  }, 30_000)
})
