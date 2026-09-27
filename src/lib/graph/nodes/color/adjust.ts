import { Color, defineNode, Float, type GlslChunk } from '@/lib/graph/authoring'

/** Small color adjustments from Blender: invert, gamma, brightness/contrast. */
const adjustChunk: GlslChunk = {
  id: 'adjust',
  requires: [],
  source: /* glsl */ `
void node_invert(vec3 color_in, float factor, out vec3 color_out) {
    color_out = mix(color_in, vec3(1.0) - color_in, factor);
}

// node_gamma.osl raises to the power itself, which is also what LED gamma correction wants
void node_gamma(vec3 color_in, float power, out vec3 color_out) {
    color_out = pow(max(color_in, vec3(0.0)), vec3(power));
}

void node_brightness_contrast(vec3 color, float brightness, float contrast, out vec3 color_out) {
    float a = 1.0 + contrast;
    float b = brightness - contrast * 0.5;
    color_out = max(a * color + b, 0.0);
}
`,
}

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
  exec: ({ color, brightness, contrast }, ctx) => ctx.call('node_brightness_contrast', [color.expr, brightness.expr, contrast.expr], { color: 'vec3' }),
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
  exec: ({ factor, color }, ctx) => ctx.call('node_invert', [color.expr, factor.expr], { color: 'vec3' }),
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
  exec: ({ color, gamma }, ctx) => ctx.call('node_gamma', [color.expr, gamma.expr], { color: 'vec3' }),
})
