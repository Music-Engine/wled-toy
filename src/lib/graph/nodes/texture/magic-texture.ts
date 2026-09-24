import { Color, defineNode, Float, Int, type GlslChunk } from '@/lib/graph/authoring'
import { commonChunk } from '@/lib/graph/nodes/glsl/common'
import { textureVector } from '@/lib/graph/nodes/shared/sockets'

/** Blender magic texture (node_magic_texture.osl) in GLSL. */
const magicTextureChunk: GlslChunk = {
  id: 'magic-texture',
  requires: [commonChunk],
  source: /* glsl */ `
vec3 magic(vec3 p, float scale, int n, float distortion)
{
  float dist = distortion;

  float a = mod(p.x * scale, M_2PI);
  float b = mod(p.y * scale, M_2PI);
  float c = mod(p.z * scale, M_2PI);

  float x = sin((a + b + c) * 5.0);
  float y = cos((-a + b - c) * 5.0);
  float z = -cos((-a - b + c) * 5.0);

  if (n > 0) {
    x *= dist;
    y *= dist;
    z *= dist;
    y = -cos(x - y + z);
    y *= dist;

    if (n > 1) {
      x = cos(x - y - z);
      x *= dist;

      if (n > 2) {
        z = sin(-x - y - z);
        z *= dist;

        if (n > 3) {
          x = -cos(-x + y - z);
          x *= dist;

          if (n > 4) {
            y = -sin(-x + y + z);
            y *= dist;

            if (n > 5) {
              y = -cos(-x + y + z);
              y *= dist;

              if (n > 6) {
                x = cos(x + y + z);
                x *= dist;

                if (n > 7) {
                  z = sin(x + y - z);
                  z *= dist;

                  if (n > 8) {
                    x = -cos(-x - y + z);
                    x *= dist;

                    if (n > 9) {
                      y = -sin(x - y + z);
                      y *= dist;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  if (dist != 0.0) {
    dist *= 2.0;
    x /= dist;
    y /= dist;
    z /= dist;
  }

  return vec3(0.5 - x, 0.5 - y, 0.5 - z);
}

void magic_texture(
    int depth,
    float distortion,
    float scale,
    vec3 vector,
    out float fac,
    out vec3 color)
{
  color = magic(vector, scale, depth, distortion);
  fac = (color.r + color.g + color.b) * (1.0 / 3.0);
}
`,
}

export const magicTextureNode = defineNode('magicTexture', {
  title: 'Magic Texture',
  description: 'Psychedelic interference of sines. Cheap, colorful, and it animates well when the vector moves.',
  category: 'noise',
  includes: [magicTextureChunk],
  input: {
    depth: { type: Int, default: 2, linkable: false, props: { min: 0, max: 10, step: 1, decimals: 0 } },
    vector: textureVector,
    scale: { type: Float, default: 5, props: { step: 0.1, decimals: 2 } },
    distortion: { type: Float, default: 1, props: { step: 0.1, decimals: 2 } },
  },
  output: { fac: Float, color: Color },
  pixel: ({ depth, vector, scale, distortion }, ctx) =>
    ctx.call('magic_texture', [String(depth), distortion.expr, scale.expr, vector.expr], { fac: 'float', color: 'vec3' }),
})
