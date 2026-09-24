import { Color, defineNode, Float } from '@/lib/graph/authoring'
import { adjustChunk } from './adjust-chunk'

const signed = { min: -1, max: 1, decimals: 2 }

export const brightnessContrastNode = defineNode('brightnessContrast', {
  title: 'Brightness/Contrast',
  description: 'Blender-style: both are 0 for no change. Contrast pivots around mid grey.',
  category: 'color',
  includes: [adjustChunk],
  input: {
    color: { type: Color, default: [1, 1, 1] },
    brightness: { type: Float, default: 0, props: signed },
    contrast: { type: Float, default: 0, props: signed },
  },
  output: { color: Color },
  pixel: ({ color, brightness, contrast }, ctx) => ctx.call('node_brightness_contrast', [color.expr, brightness.expr, contrast.expr], { color: 'vec3' }),
})

export const invertNode = defineNode('invert', {
  title: 'Invert',
  description: 'Blend a color toward its negative.',
  category: 'color',
  includes: [adjustChunk],
  input: {
    factor: { type: Float, default: 1, props: { min: 0, max: 1, decimals: 2 } },
    color: { type: Color, default: [0, 0, 0] },
  },
  output: { color: Color },
  pixel: ({ factor, color }, ctx) => ctx.call('node_invert', [color.expr, factor.expr], { color: 'vec3' }),
})

export const gammaNode = defineNode('gamma', {
  title: 'Gamma',
  description: 'Raise each channel to a power. LEDs are linear, so 2.2 to 2.8 makes fades look even.',
  category: 'color',
  includes: [adjustChunk],
  input: {
    color: { type: Color, default: [1, 1, 1] },
    gamma: { type: Float, default: 2.2, props: { min: 0.01, step: 0.1, decimals: 2 } },
  },
  output: { color: Color },
  pixel: ({ color, gamma }, ctx) => ctx.call('node_gamma', [color.expr, gamma.expr], { color: 'vec3' }),
})
