import type { GlslChunk } from '@/lib/graph/authoring'

/** Constants and the hash the noise functions build on. Named node_hash because the shader prelude owns `hash`. */
export const commonChunk: GlslChunk = {
  id: 'common',
  requires: [],
  source: /* glsl */ `
#define M_PI 3.1415926535897932384626433832795
#define M_2PI 6.283185307179586476925286766559

// https://www.shadertoy.com/view/3sd3Rs
float node_hash(float n) { return fract(sin(n) * 1e4); }
float node_hash(vec2 p) { return fract(1e4 * sin(17.0 * p.x + p.y * 0.1) * (0.1 + abs(sin(p.y * 13.0 + p.x)))); }
`,
}
