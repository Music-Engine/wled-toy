import type { GlslChunk } from '@/lib/graph/authoring'

export type MathType = 'float' | 'vec2' | 'vec3' | 'vec4'

// GLSL for each helper, written once for every vector width: `T` is the type
const HELPERS: Record<string, { requires?: string[]; source: (T: MathType) => string }> = {
  zero: {
    source: (T) =>
      T === 'float' ? 'float node_zero(float x) { return x == 0.0 ? 1.0 : 0.0; }' : `${T} node_zero(${T} x) { return ${T}(equal(x, ${T}(0.0))); }`,
  },
  // dividing by zero gives 0, as in Blender; the divisor is nudged first so no infinity is ever computed
  divide: { requires: ['zero'], source: (T) => `${T} node_divide(${T} a, ${T} b) { ${T} z = node_zero(b); return mix(a / (b + z), ${T}(0.0), z); }` },
  pow: {
    source: (T) => `${T} node_pow(${T} a, ${T} b) {
  // a negative base has a real power only for whole exponents, and then the sign alternates
  ${T} negative = ${T}(1.0) - step(${T}(0.0), a);
  ${T} whole = ${T}(1.0) - step(${T}(0.00001), abs(fract(b)));
  ${T} flip = ${T}(1.0) - 2.0 * mod(abs(b), 2.0);
  ${T} value = pow(abs(a), b) * mix(${T}(1.0), flip, negative);
  return mix(value, ${T}(0.0), negative * (${T}(1.0) - whole));
}`,
  },
  log: {
    requires: ['zero'],
    source: (T) => `${T} node_log(${T} a, ${T} base) {
  // no real logarithm for a value or base at or below zero, or a base of 1 (its log is 0)
  ${T} one = node_zero(base - ${T}(1.0));
  ${T} bad = max(max(${T}(1.0) - step(${T}(0.0000001), a), ${T}(1.0) - step(${T}(0.0000001), base)), one);
  return mix(log(max(a, ${T}(0.0000001))) / log(max(base, ${T}(0.0000001)) + one), ${T}(0.0), bad);
}`,
  },
  sqrt: { source: (T) => `${T} node_sqrt(${T} a) { return sqrt(max(a, ${T}(0.0))); }` },
  inversesqrt: {
    source: (T) =>
      `${T} node_inversesqrt(${T} a) { ${T} bad = ${T}(1.0) - step(${T}(0.0000001), a); return mix(inversesqrt(max(a, ${T}(0.0000001))), ${T}(0.0), bad); }`,
  },
  // C's fmod: the remainder keeps the sign of the dividend; a zero divisor gives 0
  modulo: {
    requires: ['zero'],
    source: (T) => `${T} node_modulo(${T} a, ${T} b) { ${T} z = node_zero(b); return mix(a - b * trunc(a / (b + z)), ${T}(0.0), z); }`,
  },
  floored_modulo: {
    requires: ['zero'],
    source: (T) => `${T} node_floored_modulo(${T} a, ${T} b) { ${T} z = node_zero(b); return mix(a - b * floor(a / (b + z)), ${T}(0.0), z); }`,
  },
  wrap: {
    requires: ['zero'],
    source: (T) =>
      `${T} node_wrap(${T} a, ${T} lo, ${T} hi) { ${T} range = hi - lo; ${T} z = node_zero(range); return mix(a - range * floor((a - lo) / (range + z)), lo, z); }`,
  },
  snap: { requires: ['divide'], source: (T) => `${T} node_snap(${T} a, ${T} increment) { return floor(node_divide(a, increment)) * increment; }` },
  pingpong: {
    requires: ['zero'],
    source: (T) =>
      `${T} node_pingpong(${T} a, ${T} scale) { ${T} z = node_zero(scale); return mix(abs(fract((a - scale) / (scale * 2.0 + z)) * scale * 2.0 - scale), ${T}(0.0), z); }`,
  },
  compare: { source: (T) => `${T} node_compare(${T} a, ${T} b, ${T} epsilon) { return step(abs(a - b), epsilon); }` },
  smoothmin: {
    requires: ['zero'],
    source: (T) => `${T} node_smoothmin(${T} a, ${T} b, ${T} k) {
  ${T} z = node_zero(k);
  ${T} h = max(k - abs(a - b), ${T}(0.0)) / (k + z);
  return min(a, b) - h * h * h * k * (1.0 / 6.0);
}`,
  },
  smoothmax: { requires: ['smoothmin'], source: (T) => `${T} node_smoothmax(${T} a, ${T} b, ${T} k) { return -node_smoothmin(-a, -b, k); }` },
  round: { source: (T) => `${T} node_round(${T} a) { return floor(a + 0.5); }` },
  asin: { source: (T) => `${T} node_asin(${T} a) { return asin(clamp(a, ${T}(-1.0), ${T}(1.0))); }` },
  acos: { source: (T) => `${T} node_acos(${T} a) { return acos(clamp(a, ${T}(-1.0), ${T}(1.0))); }` },
}

export type MathHelper = keyof typeof HELPERS

const chunks = new Map<string, GlslChunk>()

/**
 * One Blender math helper for one vector width, e.g. `node_pow` on `vec3`, as a chunk. A node includes exactly the
 * helpers its operation calls, at the width it resolved to, so an Add pulls in nothing at all.
 */
export function mathHelper(name: MathHelper, type: MathType): GlslChunk {
  const id = `math:${name}:${type}`
  let chunk = chunks.get(id)
  if (!chunk) {
    const helper = HELPERS[name]
    chunk = { id, requires: (helper.requires ?? []).map((r) => mathHelper(r as MathHelper, type)), source: `${helper.source(type)}\n` }
    chunks.set(id, chunk)
  }
  return chunk
}
