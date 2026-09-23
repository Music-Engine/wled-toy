import type { GlslChunk } from '@/lib/graph/define/context'

/** Blender brick texture (node_brick_texture.osl) in GLSL. */
export const brickTextureChunk: GlslChunk = {
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
