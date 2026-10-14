import type { GlslChunk } from '@/lib/graph/authoring'

/** Small color adjustments from Blender: invert, gamma, brightness/contrast. */
export const adjustChunk: GlslChunk = {
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
