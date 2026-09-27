import { describe, expect, it } from 'vitest'
import { graph, node, renderGraph } from '@/lib/graph/testing'

const facs = (values: object, location: [number, number, number]) => renderGraph(graph(
  [node('m', 'mapping', { location }), node('n', 'noiseTexture', { scale: 5, ...values }), node('o', 'output')],
  [['m.vector', 'n.vector'], ['n.fac', 'o.color']],
), { leds: 16 }).leds.map((led) => led[0])

const varies = (leds: number[]) => new Set(leds).size > 4

describe('Noise Texture', () => {
  it('fac spans both sides of 0.5', () => {
    const leds = facs({}, [0, 0, 0])
    expect(Math.min(...leds)).toBeLessThan(100)
    expect(Math.max(...leds)).toBeGreaterThan(156)
  })

  it('varies at negative coordinates and with distortion, instead of one flat value', () => {
    expect(varies(facs({}, [-2, -2, 0]))).toBe(true)
    expect(varies(facs({ distortion: 1 }, [0, 0, 0]))).toBe(true)
    expect(varies(facs({ distortion: 1 }, [-0.5, 0.2, 0]))).toBe(true)
  })
})
