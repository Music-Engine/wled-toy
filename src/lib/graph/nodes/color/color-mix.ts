import { defineNode } from '@/lib/graph/define/define'
import { BLEND_FUNCTIONS } from '@/lib/graph/compile/glsl/color-mix'
import { Bool, Color, Enum, Float } from '@/lib/graph/define/types'

export const BLEND_MODES = [
  { value: 'mix', label: 'Mix', group: 'Mix' }, { value: 'add', label: 'Add', group: 'Lighten' }, { value: 'multiply', label: 'Multiply', group: 'Darken' }, { value: 'screen', label: 'Screen', group: 'Lighten' },
  { value: 'overlay', label: 'Overlay', group: 'Contrast' }, { value: 'subtract', label: 'Subtract', group: 'Difference' }, { value: 'divide', label: 'Divide', group: 'Difference' }, { value: 'difference', label: 'Difference', group: 'Difference' },
  { value: 'exclusion', label: 'Exclusion', group: 'Difference' }, { value: 'darken', label: 'Darken', group: 'Darken' }, { value: 'lighten', label: 'Lighten', group: 'Lighten' }, { value: 'dodge', label: 'Dodge', group: 'Lighten' },
  { value: 'burn', label: 'Burn', group: 'Darken' }, { value: 'hue', label: 'Hue', group: 'Color' }, { value: 'saturation', label: 'Saturation', group: 'Color' }, { value: 'value', label: 'Value', group: 'Color' },
  { value: 'color', label: 'Color', group: 'Color' }, { value: 'softLight', label: 'Soft Light', group: 'Contrast' }, { value: 'linearLight', label: 'Linear Light', group: 'Contrast' },
] as const

export type BlendMode = (typeof BLEND_MODES)[number]['value']

/** `mode` is `connectable: false`, so it is known at shape-build time and the node includes only that one blend function. */
export const colorMixNode = defineNode('colorMix', ({ mode = 'mix' }: { mode?: BlendMode }) => {
  const { fn, chunk } = BLEND_FUNCTIONS[mode] ?? BLEND_FUNCTIONS.mix
  return {
    title: 'Color Mix',
    description: 'Blend two colors with one of the usual layer modes. Factor is how much of the blend replaces Color 1.',
    category: 'color',
    includes: [chunk],
    input: {
      mode: { type: Enum(BLEND_MODES), label: '', connectable: false, props: { label: 'Blend Mode' } },
      clampResult: { type: Bool, default: true, connectable: false },
      clampFactor: { type: Bool, default: true, connectable: false },
      factor: { type: Float, default: 0.5, props: { min: 0, max: 1, decimals: 2 } },
      color1: { type: Color, label: 'Color 1', default: [1, 1, 1] },
      color2: { type: Color, label: 'Color 2', default: [0, 0, 0] },
    },
    output: { color: Color },
    exec: ({ clampResult, clampFactor, factor, color1, color2 }, ctx) => {
      const f = clampFactor ? `clamp(${factor.expr}, 0.0, 1.0)` : factor.expr
      const blend = `${fn}(${f}, ${color1.expr}, ${color2.expr})`
      return { color: ctx.declare('vec3', clampResult ? `clamp(${blend}, 0.0, 1.0)` : blend) }
    },
  }
})
