import { describe, expect, it } from 'vitest'
import { createGlslCompiler } from '@/lib/graph'
import { BLEND_FUNCTIONS } from '@/lib/graph/nodes/glsl/blend'
import { graph, node, renderGraph } from '@/lib/graph/testing'
import { BLEND_MODES } from './color-mix'

describe('Color Mix and Layer Mix cover every blend mode', () => {
  it.each(BLEND_MODES.map((option) => option.value))('%s compiles and renders', async (mode) => {
    const mix = await renderGraph(graph([node('m', 'colorMix', { mode, color1: [0.8, 0.3, 0.1], color2: [0.2, 0.6, 0.9] }), node('o', 'output')], [['m.color', 'o.color']]))
    expect(mix.issues).toEqual([])
    expect(mix.leds).toHaveLength(8)

    const layer = await renderGraph(graph([node('m', 'layerMix', { mode, base: [0.8, 0.3, 0.1], layer: [0.2, 0.6, 0.9] }), node('o', 'output')], [['m.color', 'o.color']]))
    expect(layer.issues).toEqual([])
    expect(layer.leds).toHaveLength(8)
  }, 30_000)

  it('a single Color Mix graph emits only the blend function its mode calls', () => {
    const { program } = createGlslCompiler().compile(graph([node('m', 'colorMix', { mode: 'overlay' }), node('o', 'output')], [['m.color', 'o.color']]))
    // Stored colors only: a constant, folded into the pixel pass
    const code = program!.pixel
    expect(code).toContain(BLEND_FUNCTIONS.overlay.fn)
    Object.values(BLEND_FUNCTIONS).filter((blend) => blend.fn !== BLEND_FUNCTIONS.overlay.fn).forEach((blend) => expect(code).not.toContain(blend.fn))
  })
})
