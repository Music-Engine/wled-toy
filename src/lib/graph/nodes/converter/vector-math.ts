import { defineNode, Enum, Float, Vec3, type InputDef, type NodeDefinition, type OutputDef, type Value } from '@/lib/graph/authoring'
import { mathHelper, type MathHelper, type MathType } from '@/lib/graph/nodes/glsl/math'

type Vector3 = [number, number, number]
const mapComponents = (a: Vector3, apply: (x: number, i: number) => number): Vector3 => [apply(a[0], 0), apply(a[1], 1), apply(a[2], 2)]
const zipComponents = (a: Vector3, b: Vector3, apply: (x: number, y: number) => number): Vector3 => [apply(a[0], b[0]), apply(a[1], b[1]), apply(a[2], b[2])]
const computeDot = (a: Vector3, b: Vector3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const computeLength = (a: Vector3) => Math.sqrt(computeDot(a, a))
const scaleVector = (a: Vector3, s: number): Vector3 => [a[0] * s, a[1] * s, a[2] * s]

interface VectorOp {
  label: string
  group: string
  /** Vector inputs; `scalar` labels a following Scale number */
  vectors: number
  scalar?: string
  helper?: MathHelper
  /** Helper width; vec3 unless called on a number */
  helperType?: MathType
  out: 'vector' | 'value'
  glsl: (a: string, b: string, c: string, s: string) => string
  js: (a: Vector3, b: Vector3, c: Vector3, s: number) => Vector3 | number
}

export const VECTOR_OPS = {
  add: { label: 'Add', group: 'Functions', vectors: 2, out: 'vector', glsl: (a, b) => `${a} + ${b}`, js: (a, b) => zipComponents(a, b, (x, y) => x + y) },
  subtract: {
    label: 'Subtract',
    group: 'Functions',
    vectors: 2,
    out: 'vector',
    glsl: (a, b) => `${a} - ${b}`,
    js: (a, b) => zipComponents(a, b, (x, y) => x - y),
  },
  multiply: {
    label: 'Multiply',
    group: 'Functions',
    vectors: 2,
    out: 'vector',
    glsl: (a, b) => `${a} * ${b}`,
    js: (a, b) => zipComponents(a, b, (x, y) => x * y),
  },
  divide: {
    label: 'Divide',
    group: 'Functions',
    vectors: 2,
    out: 'vector',
    helper: 'divide',
    glsl: (a, b) => `node_divide(${a}, ${b})`,
    js: (a, b) => zipComponents(a, b, (x, y) => (y === 0 ? 0 : x / y)),
  },
  multiplyAdd: {
    label: 'Multiply Add',
    group: 'Functions',
    vectors: 3,
    out: 'vector',
    glsl: (a, b, c) => `${a} * ${b} + ${c}`,
    js: (a, b, c) =>
      zipComponents(
        zipComponents(a, b, (x, y) => x * y),
        c,
        (x, y) => x + y,
      ),
  },
  cross: {
    label: 'Cross Product',
    group: 'Products',
    vectors: 2,
    out: 'vector',
    glsl: (a, b) => `cross(${a}, ${b})`,
    js: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  },
  project: {
    label: 'Project',
    group: 'Products',
    vectors: 2,
    out: 'vector',
    helper: 'divide',
    helperType: 'float',
    glsl: (a, b) => `${b} * node_divide(dot(${a}, ${b}), dot(${b}, ${b}))`,
    js: (a, b) => (computeDot(b, b) === 0 ? [0, 0, 0] : scaleVector(b, computeDot(a, b) / computeDot(b, b))),
  },
  reflect: {
    label: 'Reflect',
    group: 'Products',
    vectors: 2,
    out: 'vector',
    glsl: (a, b) => `reflect(${a}, normalize(${b}))`,
    js: (a, b) => {
      const n = computeLength(b) ? scaleVector(b, 1 / computeLength(b)) : ([0, 0, 0] as Vector3)
      return zipComponents(a, scaleVector(n, 2 * computeDot(a, n)), (x, y) => x - y)
    },
  },
  dot: { label: 'Dot Product', group: 'Products', vectors: 2, out: 'value', glsl: (a, b) => `dot(${a}, ${b})`, js: computeDot },
  distance: {
    label: 'Distance',
    group: 'Magnitude',
    vectors: 2,
    out: 'value',
    glsl: (a, b) => `distance(${a}, ${b})`,
    js: (a, b) => computeLength(zipComponents(a, b, (x, y) => x - y)),
  },
  length: { label: 'Length', group: 'Magnitude', vectors: 1, out: 'value', glsl: (a) => `length(${a})`, js: computeLength },
  scale: {
    label: 'Scale',
    group: 'Magnitude',
    vectors: 1,
    scalar: 'Scale',
    out: 'vector',
    glsl: (a, _b, _c, s) => `${a} * ${s}`,
    js: (a, _b, _c, s) => scaleVector(a, s),
  },
  normalize: {
    label: 'Normalize',
    group: 'Magnitude',
    vectors: 1,
    out: 'vector',
    helper: 'zero',
    helperType: 'float',
    glsl: (a) => `normalize(${a} + vec3(node_zero(length(${a})), 0.0, 0.0))`,
    js: (a) => (computeLength(a) ? scaleVector(a, 1 / computeLength(a)) : [1, 0, 0]),
  },
  absolute: { label: 'Absolute', group: 'Rounding', vectors: 1, out: 'vector', glsl: (a) => `abs(${a})`, js: (a) => mapComponents(a, Math.abs) },
  minimum: { label: 'Minimum', group: 'Rounding', vectors: 2, out: 'vector', glsl: (a, b) => `min(${a}, ${b})`, js: (a, b) => zipComponents(a, b, Math.min) },
  maximum: { label: 'Maximum', group: 'Rounding', vectors: 2, out: 'vector', glsl: (a, b) => `max(${a}, ${b})`, js: (a, b) => zipComponents(a, b, Math.max) },
  floor: { label: 'Floor', group: 'Rounding', vectors: 1, out: 'vector', glsl: (a) => `floor(${a})`, js: (a) => mapComponents(a, Math.floor) },
  ceil: { label: 'Ceil', group: 'Rounding', vectors: 1, out: 'vector', glsl: (a) => `ceil(${a})`, js: (a) => mapComponents(a, Math.ceil) },
  fraction: {
    label: 'Fraction',
    group: 'Rounding',
    vectors: 1,
    out: 'vector',
    glsl: (a) => `fract(${a})`,
    js: (a) => mapComponents(a, (x) => x - Math.floor(x)),
  },
  modulo: {
    label: 'Modulo',
    group: 'Rounding',
    vectors: 2,
    out: 'vector',
    helper: 'modulo',
    glsl: (a, b) => `node_modulo(${a}, ${b})`,
    js: (a, b) => zipComponents(a, b, (x, y) => (y === 0 ? 0 : x - y * Math.trunc(x / y))),
  },
  wrap: {
    label: 'Wrap',
    group: 'Rounding',
    vectors: 3,
    out: 'vector',
    helper: 'wrap',
    glsl: (a, b, c) => `node_wrap(${a}, ${b}, ${c})`,
    js: (a, lo, hi) => mapComponents(a, (x, i) => (hi[i] - lo[i] === 0 ? lo[i] : x - (hi[i] - lo[i]) * Math.floor((x - lo[i]) / (hi[i] - lo[i])))),
  },
  snap: {
    label: 'Snap',
    group: 'Rounding',
    vectors: 2,
    out: 'vector',
    helper: 'snap',
    glsl: (a, b) => `node_snap(${a}, ${b})`,
    js: (a, b) => zipComponents(a, b, (x, y) => (y === 0 ? 0 : Math.floor(x / y) * y)),
  },
  sine: { label: 'Sine', group: 'Trigonometric', vectors: 1, out: 'vector', glsl: (a) => `sin(${a})`, js: (a) => mapComponents(a, Math.sin) },
  cosine: { label: 'Cosine', group: 'Trigonometric', vectors: 1, out: 'vector', glsl: (a) => `cos(${a})`, js: (a) => mapComponents(a, Math.cos) },
  tangent: { label: 'Tangent', group: 'Trigonometric', vectors: 1, out: 'vector', glsl: (a) => `tan(${a})`, js: (a) => mapComponents(a, Math.tan) },
} satisfies Record<string, VectorOp>

export type VectorOpName = keyof typeof VECTOR_OPS
const VECTOR_OP_OPTIONS = Object.entries(VECTOR_OPS).map(([value, op]) => ({ value: value as VectorOpName, label: op.label, group: op.group }))

/** On 3D vectors; a linked number spreads to all three components */
export const vectorMathNode = defineNode('vectorMath', ({ op = 'add' }: { op?: VectorOpName }) => {
  const operation: VectorOp = VECTOR_OPS[op] ?? VECTOR_OPS.add
  const toVectorInput = (fallback: number[]) => ({ type: Vec3, label: 'Vector', default: fallback })
  // Output differs by op, so loosely typed; `operation` carries the contract
  const options: NodeDefinition<Record<string, InputDef>, Record<string, OutputDef>> = {
    title: 'Vector Math',
    description:
      'Operations on whole vectors: add, scale, cross and dot products, distance, projection, wrap and snap. Combine XYZ builds a vector from numbers.',
    category: 'converter',
    presets: VECTOR_OP_OPTIONS.map((option) => ({ title: option.label, values: { op: option.value } })),
    input: {
      op: { type: Enum(VECTOR_OP_OPTIONS), label: '', default: 'add', linkable: false, props: { label: 'Operation' } },
      a: toVectorInput([0.5, 0.5, 0]),
      ...(operation.vectors > 1 && { b: toVectorInput(op === 'wrap' ? [0, 0, 0] : [0.5, 0.5, 0.5]) }),
      ...(operation.vectors > 2 && { c: toVectorInput(op === 'wrap' ? [1, 1, 1] : [0, 0, 0]) }),
      ...(operation.scalar && { scale: { type: Float, label: operation.scalar, default: 1 } }),
    },
    output: operation.out === 'vector' ? { vector: Vec3 } : { value: Float },
    body: (input: Record<string, any>, ctx): Record<string, Value> => {
      if (operation.helper) ctx.include(mathHelper(operation.helper, operation.helperType ?? 'vec3'))
      const expr = operation.glsl(input.a.expr, input.b?.expr ?? 'vec3(0.0)', input.c?.expr ?? 'vec3(0.0)', input.scale?.expr ?? '1.0')
      return operation.out === 'vector' ? { vector: ctx.declare('vec3', expr) } : { value: ctx.declare('float', expr) }
    },
  }
  return options
})
