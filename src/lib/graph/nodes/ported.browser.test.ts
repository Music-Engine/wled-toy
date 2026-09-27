import { describe, expect, it } from 'vitest'
import { createGlslCompiler } from '@/lib/graph'
import { graph, node, renderGraph } from '@/lib/graph/testing'

const expectNear = (actual: number[][], expected: number[][], tolerance = 2) =>
  actual.forEach((led, i) => led.forEach((c, k) => expect(Math.abs(c - expected[i][k]), `LED ${i} channel ${k}: ${led} vs ${expected[i]}`).toBeLessThanOrEqual(tolerance)))

describe('ported nodes', () => {
  it('Checker Texture at scale 4 alternates its two colors every two of eight LEDs', async () => {
    // uv.x along the strip at y = 0.1, the checker's old scanline
    const { leds } = await renderGraph(graph(
      [node('uv', 'uv'), node('p', 'combineXYZ', { y: 0.1, z: 0 }), node('c', 'checkerTexture', { scale: 4, color1: [1, 0, 0], color2: [0, 0, 1] }), node('o', 'output')],
      [['uv.x', 'p.x'], ['p.vector', 'c.vector'], ['c.color', 'o.color']],
    ))
    const red = [255, 0, 0]
    const blue = [0, 0, 255]
    // Row y = 0.1 * 4 is cell 0, so color flips w/ the x cell alone
    expect(leds).toEqual([blue, blue, red, red, blue, blue, red, red])
  })

  it('Color Mix: Multiply at factor 1, and Mix at factor 0.25', async () => {
    const renderMix = async (values: object) => (await renderGraph(graph([node('m', 'colorMix', { color1: [0.5, 0.5, 0.5], color2: [1, 0, 0], ...values }), node('o', 'output')], [['m.color', 'o.color']]), { leds: 1 })).leds[0]
    expect(await renderMix({ mode: 'multiply', factor: 1 })).toEqual([128, 0, 0])
    expectNear([await renderMix({ mode: 'mix', factor: 0.25 })], [[159, 96, 96]])
  }, 30_000)

  it('Brightness/Contrast at 0 / 0 changes nothing', async () => {
    const { leds } = await renderGraph(graph([node('b', 'brightnessContrast', { color: [0.2, 0.5, 0.8] }), node('o', 'output')], [['b.color', 'o.color']]), { leds: 1 })
    expect(leds[0]).toEqual([51, 128, 204])
  })

  it('RGB to HSV and back is lossless to a byte', async () => {
    const { leds } = await renderGraph(graph(
      [node('a', 'rgb2hsv', { color: [0.8, 0.3, 0.55] }), node('b', 'hsv2rgb'), node('o', 'output')],
      [['a.hsv', 'b.hsv'], ['b.color', 'o.color']],
    ), { leds: 1 })
    expectNear(leds, [[204, 77, 140]], 1)
  })

  it('Combine Color wraps the hue in HSV and HSL', async () => {
    const renderColor = async (mode: string, a: number) => {
      const { leds, issues } = await renderGraph(graph([node('c', 'combineColor', { mode, a, b: 1, c: mode === 'hsl' ? 0.5 : 1 }), node('o', 'output')], [['c.color', 'o.color']]), { leds: 1 })
      expect(issues, `${mode} ${a}`).toEqual([])
      return leds[0]
    }
    for (const mode of ['hsv', 'hsl']) {
      expectNear([await renderColor(mode, 1.25)], [await renderColor(mode, 0.25)], 1)
      expectNear([await renderColor(mode, -0.75)], [await renderColor(mode, 0.25)], 1)
      expect(await renderColor(mode, 0.25)).not.toEqual(await renderColor(mode, 0.5))
    }
  }, 60_000)

  it('emits a shared chunk once and leaves unused chunks out', () => {
    const { program, issues } = createGlslCompiler().compile(graph(
      [node('w', 'waveTexture'), node('n', 'noiseTexture'), node('m', 'math', { op: 'add' }), node('o', 'output')],
      [['w.fac', 'm.a'], ['n.fac', 'm.b'], ['m.result', 'o.color']],
    ))
    expect(issues).toEqual([])
    const code = program!.pixel
    expect(code.match(/float noise_fbm\(/g)).toHaveLength(1)
    expect(code.match(/float node_hash\(float/g)).toHaveLength(1)
    expect(code).not.toContain('node_mix_blend')
    expect(code.indexOf('node_hash(float')).toBeLessThan(code.indexOf('float noise1('))
  })

  it('compile errors still point at the node that emitted the line when chunks sit above it', () => {
    const { program } = createGlslCompiler().compile(graph([node('w', 'waveTexture'), node('o', 'output')], [['w.color', 'o.color']]))
    const line = program!.pixel.split('\n').findIndex((l) => l.includes('wave_texture(0,')) + 1
    expect(program!.lineNodes.pixel[line]).toBe('w')
  })
})
