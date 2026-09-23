import type { GlslChunk } from '@/lib/graph/define/context'

/** Blender checker texture (node_checker_texture.osl) in GLSL. */
export const checkerTextureChunk: GlslChunk = {
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
