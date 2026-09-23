import { defineNode } from '@/lib/graph/define/define'
import type { FrameValue, InputDef, NodeItemOptions, OutputDef } from '@/lib/graph/define/node'
import type { Value } from '@/lib/graph/define/value'
import { mathHelper, type MathHelper, type MathType } from '@/lib/graph/compile/glsl/math'
import { Enum, Float, Vec3 } from '@/lib/graph/define/types'

type V = [number, number, number]
const map = (a: V, fn: (x: number, i: number) => number): V => [fn(a[0], 0), fn(a[1], 1), fn(a[2], 2)]
const zip = (a: V, b: V, fn: (x: number, y: number) => number): V => [fn(a[0], b[0]), fn(a[1], b[1]), fn(a[2], b[2])]
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a: V) => Math.sqrt(dot(a, a))
const scale = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s]

interface VectorOp {
  label: string
  group: string
  /** Vector inputs, then whether a Scale number follows. */
  vectors: number
  scalar?: string
  helper?: MathHelper
  /** Width the helper is called at; vec3 unless the operation calls it on a number. */
  helperType?: MathType
  /** The kind of the one output. */
  out: 'vector' | 'value'
  glsl: (a: string, b: string, c: string, s: string) => string
  js: (a: V, b: V, c: V, s: number) => V | number
}

export const VECTOR_OPS = {
  add: { label: 'Add', group: 'Functions', vectors: 2, out: 'vector', glsl: (a, b) => `${a} + ${b}`, js: (a, b) => zip(a, b, (x, y) => x + y) },
  subtract: { label: 'Subtract', group: 'Functions', vectors: 2, out: 'vector', glsl: (a, b) => `${a} - ${b}`, js: (a, b) => zip(a, b, (x, y) => x - y) },
  multiply: { label: 'Multiply', group: 'Functions', vectors: 2, out: 'vector', glsl: (a, b) => `${a} * ${b}`, js: (a, b) => zip(a, b, (x, y) => x * y) },
  divide: { label: 'Divide', group: 'Functions', vectors: 2, out: 'vector', helper: 'divide', glsl: (a, b) => `node_divide(${a}, ${b})`, js: (a, b) => zip(a, b, (x, y) => (y === 0 ? 0 : x / y)) },
  multiplyAdd: { label: 'Multiply Add', group: 'Functions', vectors: 3, out: 'vector', glsl: (a, b, c) => `${a} * ${b} + ${c}`, js: (a, b, c) => zip(zip(a, b, (x, y) => x * y), c, (x, y) => x + y) },
  cross: { label: 'Cross Product', group: 'Products', vectors: 2, out: 'vector', glsl: (a, b) => `cross(${a}, ${b})`, js: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] },
  project: { label: 'Project', group: 'Products', vectors: 2, out: 'vector', helper: 'divide', helperType: 'float', glsl: (a, b) => `${b} * node_divide(dot(${a}, ${b}), dot(${b}, ${b}))`, js: (a, b) => (dot(b, b) === 0 ? [0, 0, 0] : scale(b, dot(a, b) / dot(b, b))) },
  reflect: { label: 'Reflect', group: 'Products', vectors: 2, out: 'vector', glsl: (a, b) => `reflect(${a}, normalize(${b}))`, js: (a, b) => { const n = len(b) ? scale(b, 1 / len(b)) : [0, 0, 0] as V; return zip(a, scale(n, 2 * dot(a, n)), (x, y) => x - y) } },
  dot: { label: 'Dot Product', group: 'Products', vectors: 2, out: 'value', glsl: (a, b) => `dot(${a}, ${b})`, js: dot },
  distance: { label: 'Distance', group: 'Magnitude', vectors: 2, out: 'value', glsl: (a, b) => `distance(${a}, ${b})`, js: (a, b) => len(zip(a, b, (x, y) => x - y)) },
  length: { label: 'Length', group: 'Magnitude', vectors: 1, out: 'value', glsl: (a) => `length(${a})`, js: len },
  scale: { label: 'Scale', group: 'Magnitude', vectors: 1, scalar: 'Scale', out: 'vector', glsl: (a, _b, _c, s) => `${a} * ${s}`, js: (a, _b, _c, s) => scale(a, s) },
  normalize: { label: 'Normalize', group: 'Magnitude', vectors: 1, out: 'vector', helper: 'zero', helperType: 'float', glsl: (a) => `normalize(${a} + vec3(node_zero(length(${a})), 0.0, 0.0))`, js: (a) => (len(a) ? scale(a, 1 / len(a)) : [1, 0, 0]) },
  absolute: { label: 'Absolute', group: 'Rounding', vectors: 1, out: 'vector', glsl: (a) => `abs(${a})`, js: (a) => map(a, Math.abs) },
  minimum: { label: 'Minimum', group: 'Rounding', vectors: 2, out: 'vector', glsl: (a, b) => `min(${a}, ${b})`, js: (a, b) => zip(a, b, Math.min) },
  maximum: { label: 'Maximum', group: 'Rounding', vectors: 2, out: 'vector', glsl: (a, b) => `max(${a}, ${b})`, js: (a, b) => zip(a, b, Math.max) },
  floor: { label: 'Floor', group: 'Rounding', vectors: 1, out: 'vector', glsl: (a) => `floor(${a})`, js: (a) => map(a, Math.floor) },
  ceil: { label: 'Ceil', group: 'Rounding', vectors: 1, out: 'vector', glsl: (a) => `ceil(${a})`, js: (a) => map(a, Math.ceil) },
  fraction: { label: 'Fraction', group: 'Rounding', vectors: 1, out: 'vector', glsl: (a) => `fract(${a})`, js: (a) => map(a, (x) => x - Math.floor(x)) },
  modulo: { label: 'Modulo', group: 'Rounding', vectors: 2, out: 'vector', helper: 'modulo', glsl: (a, b) => `node_modulo(${a}, ${b})`, js: (a, b) => zip(a, b, (x, y) => (y === 0 ? 0 : x - y * Math.trunc(x / y))) },
  wrap: { label: 'Wrap', group: 'Rounding', vectors: 3, out: 'vector', helper: 'wrap', glsl: (a, b, c) => `node_wrap(${a}, ${b}, ${c})`, js: (a, lo, hi) => map(a, (x, i) => (hi[i] - lo[i] === 0 ? lo[i] : x - (hi[i] - lo[i]) * Math.floor((x - lo[i]) / (hi[i] - lo[i])))) },
  snap: { label: 'Snap', group: 'Rounding', vectors: 2, out: 'vector', helper: 'snap', glsl: (a, b) => `node_snap(${a}, ${b})`, js: (a, b) => zip(a, b, (x, y) => (y === 0 ? 0 : Math.floor(x / y) * y)) },
  sine: { label: 'Sine', group: 'Trigonometric', vectors: 1, out: 'vector', glsl: (a) => `sin(${a})`, js: (a) => map(a, Math.sin) },
  cosine: { label: 'Cosine', group: 'Trigonometric', vectors: 1, out: 'vector', glsl: (a) => `cos(${a})`, js: (a) => map(a, Math.cos) },
  tangent: { label: 'Tangent', group: 'Trigonometric', vectors: 1, out: 'vector', glsl: (a) => `tan(${a})`, js: (a) => map(a, Math.tan) },
} satisfies Record<string, VectorOp>

export type VectorOpName = keyof typeof VECTOR_OPS
export const VECTOR_OP_OPTIONS = Object.entries(VECTOR_OPS).map(([value, op]) => ({ value: value as VectorOpName, label: op.label, group: op.group }))

const asVector = (v: number | number[]): V => (Array.isArray(v) ? [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0] : [v, v, v])

/** Blender's Vector Math node, on 3D vectors. A number linked in spreads to all three components. */
export const vectorMathNode = defineNode('vectorMath', ({ op = 'add' }: { op?: VectorOpName }) => {
  const def: VectorOp = VECTOR_OPS[op] ?? VECTOR_OPS.add
  const vec = (fallback: number[]) => ({ type: Vec3, label: 'Vector', default: fallback })
  // the output differs by operation, so this shape is typed loosely and `def` carries the real contract
  const options: NodeItemOptions<Record<string, InputDef>, Record<string, OutputDef>> = {
    title: 'Vector Math',
    description: 'Operations on whole vectors: add, scale, cross and dot products, distance, projection, wrap and snap. Combine XYZ builds a vector from numbers.',
    category: 'converter',
    input: {
      op: { type: Enum(VECTOR_OP_OPTIONS), label: '', default: 'add', connectable: false, props: { label: 'Operation' } },
      a: vec([0.5, 0.5, 0]),
      ...(def.vectors > 1 && { b: vec(op === 'wrap' ? [0, 0, 0] : [0.5, 0.5, 0.5]) }),
      ...(def.vectors > 2 && { c: vec(op === 'wrap' ? [1, 1, 1] : [0, 0, 0]) }),
      ...(def.scalar && { scale: { type: Float, label: def.scalar, default: 1 } }),
    },
    output: def.out === 'vector' ? { vector: Vec3 } : { value: Float },
    exec: (input: Record<string, any>, ctx): Record<string, Value> => {
      if (def.helper) ctx.include(mathHelper(def.helper, def.helperType ?? 'vec3'))
      const expr = def.glsl(input.a.expr, input.b?.expr ?? 'vec3(0.0)', input.c?.expr ?? 'vec3(0.0)', input.scale?.expr ?? '1.0')
      return def.out === 'vector' ? { vector: ctx.declare('vec3', expr) } : { value: ctx.declare('float', expr) }
    },
    run: (input: Record<string, any>): Record<string, FrameValue> => {
      const result = def.js(asVector(input.a), asVector(input.b ?? 0), asVector(input.c ?? 0), (input.scale as number) ?? 1)
      return def.out === 'vector' ? { vector: result as V } : { value: result as number }
    },
  }
  return options
})
