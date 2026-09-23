import { defineNode } from '@/lib/graph/define/define'
import type { GlslChunk } from '@/lib/graph/define/context'
import { Color, Float, Int } from '@/lib/graph/define/socket-types'
import { textureVector } from './vector'

/** Blender brick texture (node_brick_texture.osl) in GLSL. */
const brickTextureChunk: GlslChunk = {
  id: 'brick-texture',
  requires: [],
  source: /* glsl */ `
float brick_noise(int ns) {
    int n = (ns + 1013) & 2147483647;
    n = (n >> 13) ^ n;
    int nn = (n * (n * n * 60493 + 19990303) + 1376312589) & 2147483647;
    return 0.5 * (float(nn) / 1073741824.0);
}

float brick(vec3 p,
            float mortar_size,
            float mortar_smooth,
            float bias,
            float brickWidth,
            float row_height,
            float offset_amount,
            int offset_frequency,
            float squash_amount,
            int squash_frequency,
            out float tint) {
    int rownum = int(floor(p.y / row_height));

    float offset = 0.0;
    float current_brick_width = brickWidth;

    if (offset_frequency != 0 && squash_frequency != 0) {
        current_brick_width *= (rownum % squash_frequency) != 0 ? 1.0 : squash_amount;
        offset = (rownum % offset_frequency) != 0 ? 0.0 : (current_brick_width * offset_amount);
    }

    int bricknum = int(floor((p.x + offset) / current_brick_width));

    float x = (p.x + offset) - current_brick_width * float(bricknum);
    float y = p.y - row_height * float(rownum);

    tint = clamp(brick_noise((rownum << 16) + (bricknum & 65535)) + bias, 0.0, 1.0);

    float min_dist = min(min(x, y), min(current_brick_width - x, row_height - y));
    if (min_dist >= mortar_size) {
        return 0.0;
    } else if (mortar_smooth == 0.0) {
        return 1.0;
    } else {
        min_dist = 1.0 - min_dist / mortar_size;
        return smoothstep(0.0, mortar_smooth, min_dist);
    }
}

void brick_texture(
    float offset,
    int offset_frequency,
    float squash,
    int squash_frequency,
    float scale,
    float mortarSize,
    float mortarSmooth,
    float bias,
    float brickWidth,
    float rowHeight,
    vec3 Vector,
    vec3 Color1,
    vec3 Color2,
    vec3 Mortar,
    out float Fac,
    out vec3 Color
) {
    vec3 p = Vector;

    float tint = 0.0;
    vec3 col = Color1;

    Fac = brick(p * scale,
                mortarSize,
                mortarSmooth,
                bias,
                brickWidth,
                rowHeight,
                offset,
                offset_frequency,
                squash,
                squash_frequency,
                tint);

    if (Fac != 1.0) {
        col = mix(Color1, Color2, tint);
    }

    Color = mix(col, Mortar, Fac);
}
`,
}

const amount = { min: 0, step: 0.01, decimals: 2 }
const frequency = { min: 1, step: 1, decimals: 0 }

export const brickTextureNode = defineNode('brickTexture', {
  title: 'Brick Texture',
  description: 'Rows of bricks with mortar between them. Every Offset Frequency rows shift sideways, every Squash Frequency rows change width.',
  category: 'noise',
  includes: [brickTextureChunk],
  input: {
    offset: { type: Float, default: 0.5, connectable: false, props: { ...amount, max: 1 } },
    offsetFrequency: { type: Int, default: 2, connectable: false, props: frequency },
    squash: { type: Float, default: 1, connectable: false, props: amount },
    squashFrequency: { type: Int, default: 1, connectable: false, props: frequency },
    vector: textureVector,
    color1: { type: Color, label: 'Color 1', default: [1, 1, 1] },
    color2: { type: Color, label: 'Color 2', default: [0, 0, 0] },
    mortar: { type: Color, default: [0.67, 0.67, 0.67] },
    scale: { type: Float, default: 5, props: amount },
    mortarSize: { type: Float, default: 0.02, props: amount },
    mortarSmooth: { type: Float, default: 0, props: { ...amount, max: 1 } },
    bias: { type: Float, default: 0, props: { min: -1, max: 1, step: 0.01, decimals: 2 } },
    brickWidth: { type: Float, default: 0.5, props: amount },
    rowHeight: { type: Float, default: 0.25, props: amount },
  },
  output: { fac: Float, color: Color },
  exec: (input, ctx) => ctx.call('brick_texture', [
    Float.literal(input.offset).expr, String(input.offsetFrequency), Float.literal(input.squash).expr, String(input.squashFrequency),
    input.scale.expr, input.mortarSize.expr, input.mortarSmooth.expr, input.bias.expr, input.brickWidth.expr, input.rowHeight.expr,
    input.vector.expr, input.color1.expr, input.color2.expr, input.mortar.expr,
  ], { fac: 'float', color: 'vec3' }),
})
