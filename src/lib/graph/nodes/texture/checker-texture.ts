import { Color, defineNode, Float, type GlslChunk } from '@/lib/graph/authoring'
import { textureVector } from './vector'

/** Blender checker texture (node_checker_texture.osl) in GLSL. */
const checkerTextureChunk: GlslChunk = {
  id: 'checker-texture',
  requires: [],
  source: /* glsl */ `
float checker(vec3 ip) {
    vec3 p = (ip + vec3(0.000001)) * 0.999999;

    int xi = int(abs(floor(p.x)));
    int yi = int(abs(floor(p.y)));
    int zi = int(abs(floor(p.z)));

    if (((xi % 2 == yi % 2) == (zi % 2 == 1))) {
        return 1.0;
    }
    else {
        return 0.0;
    }
}

void checker_texture(
    float scale,
    vec3 Vector,
    vec3 Color1,
    vec3 Color2,
    out float Fac,
    out vec3 Color
) {
    vec3 p = Vector;

    Fac = checker(p * scale);
    Color = mix(Color2, Color1, Fac);
}
`,
}

export const checkerTextureNode = defineNode('checkerTexture', {
  title: 'Checker Texture',
  description: 'Alternating cells of two colors. On a strip this is a row of Scale segments.',
  category: 'noise',
  includes: [checkerTextureChunk],
  input: {
    vector: textureVector,
    color1: { type: Color, label: 'Color 1', default: [1, 1, 1] },
    color2: { type: Color, label: 'Color 2', default: [0, 0, 0] },
    scale: { type: Float, default: 5, props: { min: 0, step: 0.1, decimals: 2 } },
  },
  output: { fac: Float, color: Color },
  pixel: ({ vector, color1, color2, scale }, ctx) =>
    ctx.call('checker_texture', [scale.expr, vector.expr, color1.expr, color2.expr], { fac: 'float', color: 'vec3' }),
})
