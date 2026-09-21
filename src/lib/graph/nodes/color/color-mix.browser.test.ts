import { describe, expect, it } from 'vitest'
import { BLEND_FUNCTIONS } from '@/lib/graph/compile/glsl/color-mix'
import { graph, node, renderGraph } from '@/lib/graph/testing'
import { BLEND_MODES } from './color-mix'

describe('Color Mix and Layer Mix cover every blend mode', () => {
  it.each(BLEND_MODES.map((m) => m.value))('%s compiles and renders', (mode) => {
    const mix = renderGraph(graph([node('m', 'colorMix', { mode, color1: [0.8, 0.3, 0.1], color2: [0.2, 0.6, 0.9] }), node('o', 'output')], [['m.color', 'o.color']]))
    expect(mix.compileError, mix.shader.code).toBeNull()

    const layer = renderGraph(graph([node('m', 'layerMix', { mode, base: [0.8, 0.3, 0.1], layer: [0.2, 0.6, 0.9] }), node('o', 'output')], [['m.color', 'o.color']]))
    expect(layer.compileError, layer.shader.code).toBeNull()
  })

  it('a single Color Mix graph emits only the blend function its mode calls', () => {
    const { shader } = renderGraph(graph([node('m', 'colorMix', { mode: 'overlay' }), node('o', 'output')], [['m.color', 'o.color']]))
    expect(shader.code).toContain(BLEND_FUNCTIONS.overlay.fn)
    Object.values(BLEND_FUNCTIONS).filter((b) => b.fn !== BLEND_FUNCTIONS.overlay.fn).forEach((b) => expect(shader.code).not.toContain(b.fn))
  })
})
