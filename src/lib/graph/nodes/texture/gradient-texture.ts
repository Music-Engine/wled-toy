import { Color, defineNode, Enum, enumIndex, Float, type GlslChunk } from '@/lib/graph/authoring'
import { commonChunk } from '@/lib/graph/nodes/glsl/common'
import { textureVector } from './vector'

/** Blender gradient texture (node_gradient_texture.osl) in GLSL. */
const gradientTextureChunk: GlslChunk = {
  id: 'gradient-texture',
  requires: [commonChunk],
  source: /* glsl */ `
// Gradient texture
// Based on https://github.com/blender/blender/blob/8f6af72a3f374a16aab0ec980b5af5ba5a3f442f/intern/cycles/kernel/osl/shaders/node_gradient_texture.osl
// Types:
// 0 = linear, 1 = quadratic, 2 = easing
// 3 = diagonal, 4 = radial, 5 = spherical
// 6 = quadratic_sphere
float gradient(vec3 p, int type) {
  float x, y, z;

  x = p[0];
  y = p[1];
  z = p[2];

  float result = 0.0;

  if (type == 0) {
    result = x;
  }
  else if (type == 1) {
    float r = max(x, 0.0);
    result = r * r;
  }
  else if (type == 2) {
    float r = min(max(x, 0.0), 1.0);
    float t = r * r;

    result = (3.0 * t - 2.0 * t * r);
  }
  else if (type == 3) {
    result = (x + y) * 0.5;
  }
  else if (type == 4) {
    result = atan(y, x) / M_2PI + 0.5;
  }
  else {
    float r = max(1.0 - sqrt(x * x + y * y + z * z), 0.0);

    if (type == 6)
      result = r * r;
    else if (type == 5)
      result = r;
  }

  return clamp(result, 0.0, 1.0);
}

void gradient_texture(
    vec3 Vector,
    int Type,
    out float Fac,
    out vec3 Color
) {
    // Gradient texture
    Fac = gradient(Vector, Type);
    Color = vec3(Fac);
}
`,
}

const TYPES = [
  { value: 'linear', label: 'Linear' }, { value: 'quadratic', label: 'Quadratic' }, { value: 'easing', label: 'Easing' }, { value: 'diagonal', label: 'Diagonal' },
  { value: 'radial', label: 'Radial' }, { value: 'spherical', label: 'Spherical' }, { value: 'quadraticSphere', label: 'Quadratic Sphere' },
] as const

export const gradientTextureNode = defineNode('gradientTexture', {
  title: 'Gradient Texture',
  description: 'A 0 to 1 ramp across space: along x, around the origin, or falling off from it.',
  category: 'noise',
  includes: [gradientTextureChunk],
  input: {
    type: { type: Enum(TYPES), label: '', linkable: false, props: { label: 'Gradient' } },
    vector: textureVector,
  },
  output: { fac: Float, color: Color },
  pixel: ({ type, vector }, ctx) => ctx.call('gradient_texture', [vector.expr, enumIndex(TYPES, type)], { fac: 'float', color: 'vec3' }),
})
