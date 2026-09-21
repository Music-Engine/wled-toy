import { defineNode } from '@/lib/graph/define/define'
import { BLEND_FUNCTIONS } from '@/lib/graph/compile/glsl/color-mix'
import { Bool, Color, Enum, Float } from '@/lib/graph/define/types'
import { BLEND_MODES, type BlendMode } from './color-mix'

/** `mode` is `connectable: false`, so it is known at shape-build time and the node includes only that one blend function. */
export const layerMixNode = defineNode('layerMix', ({ mode = 'mix' }: { mode?: BlendMode }) => {
  const { fn, chunk } = BLEND_FUNCTIONS[mode] ?? BLEND_FUNCTIONS.mix
  return {
    title: 'Layer Mix',
    description: 'Puts Layer over Base. Opacity and Mask multiply, so a mask can cut a layer to a shape and opacity can fade the whole layer in.',
    category: 'color',
    includes: [chunk],
    input: {
      mode: { type: Enum(BLEND_MODES), label: '', connectable: false, props: { label: 'Blend Mode' } },
      base: { type: Color, default: [0, 0, 0] },
      layer: { type: Color, default: [1, 1, 1] },
      opacity: { type: Float, default: 1, props: { min: 0, max: 1, decimals: 2 } },
      mask: { type: Float, default: 1, props: { min: 0, max: 1, decimals: 2 } },
    },
    output: { color: Color },
    exec: ({ base, layer, opacity, mask }, ctx) =>
      ({ color: ctx.declare('vec3', `clamp(${fn}(clamp(${opacity.expr} * ${mask.expr}, 0.0, 1.0), ${base.expr}, ${layer.expr}), 0.0, 1.0)`) }),
  }
})

export const maskNode = defineNode('mask', {
  title: 'Mask',
  description: 'Turns a value into a 0 to 1 mask: 1 where it is above Threshold, with Softness as the width of the edge.',
  category: 'color',
  input: {
    invert: { type: Bool, default: false, connectable: false },
    value: { type: Float, default: { expr: 'uv.x', label: 'uv.x' } },
    threshold: { type: Float, default: 0.5, props: { decimals: 3 } },
    softness: { type: Float, default: 0.05, props: { min: 0, decimals: 3 } },
  },
  output: { mask: Float },
  exec: ({ invert, value, threshold, softness }, ctx) => {
    // a zero-width smoothstep is undefined, so the edge never gets narrower than this
    const edge = ctx.declare('float', `max(${softness.expr}, 0.0001) * 0.5`, 'edge').expr
    const mask = `smoothstep(${threshold.expr} - ${edge}, ${threshold.expr} + ${edge}, ${value.expr})`
    return { mask: ctx.declare('float', invert ? `1.0 - ${mask}` : mask) }
  },
})

export const brightnessCeilingNode = defineNode('brightnessCeiling', {
  title: 'Brightness Ceiling',
  description: 'Scales a color down so its brightest channel never exceeds Ceiling. Unlike a clamp it keeps the hue.',
  category: 'color',
  input: {
    color: { type: Color, default: [1, 1, 1] },
    ceiling: { type: Float, default: 0.8, props: { min: 0, max: 1, decimals: 2 } },
  },
  output: { color: Color },
  exec: ({ color, ceiling }, ctx) => {
    const c = ctx.declare('vec3', color.expr, 'in').expr
    return { color: ctx.declare('vec3', `${c} * min(1.0, ${ceiling.expr} / max(max(${c}.r, max(${c}.g, ${c}.b)), 0.0001))`) }
  },
})
