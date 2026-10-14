import { Bool, defineNode, Enum, GenType } from '@/lib/graph/authoring'
import { mathHelper, type MathHelper, type MathType } from '@/lib/graph/nodes/glsl/math'

interface MathOp {
  label: string
  group: string
  /** Socket labels in order; count = values taken */
  inputs: string[]
  /** Second and third value's defaults */
  defaults?: [number?, number?]
  /** Pulled in only when the op runs */
  helper?: MathHelper
  glsl: (a: string, b: string, c: string) => string
  js: (a: number, b: number, c: number) => number
}

const computeModulo = (a: number, b: number) => (b === 0 ? 0 : a - b * Math.trunc(a / b))
const computeFlooredModulo = (a: number, b: number) => (b === 0 ? 0 : a - b * Math.floor(a / b))
const computeSafePower = (a: number, b: number) => (a >= 0 ? a ** b : Number.isInteger(b) ? Math.abs(a) ** b * (Math.abs(b) % 2 === 0 ? 1 : -1) : 0)
const computeSmoothMin = (a: number, b: number, k: number) => {
  if (k === 0) return Math.min(a, b)
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * h * k * (1 / 6)
}

/** Blender's Math ops, keyed by stored value; vectors go per component */
export const MATH_OPS = {
  add: { label: 'Add', group: 'Functions', inputs: ['Value', 'Value'], glsl: (a, b) => `${a} + ${b}`, js: (a, b) => a + b },
  subtract: { label: 'Subtract', group: 'Functions', inputs: ['Value', 'Value'], glsl: (a, b) => `${a} - ${b}`, js: (a, b) => a - b },
  multiply: { label: 'Multiply', group: 'Functions', inputs: ['Value', 'Value'], defaults: [1], glsl: (a, b) => `${a} * ${b}`, js: (a, b) => a * b },
  divide: {
    label: 'Divide',
    group: 'Functions',
    inputs: ['Value', 'Value'],
    defaults: [1],
    helper: 'divide',
    glsl: (a, b) => `node_divide(${a}, ${b})`,
    js: (a, b) => (b === 0 ? 0 : a / b),
  },
  multiplyAdd: {
    label: 'Multiply Add',
    group: 'Functions',
    inputs: ['Value', 'Multiplier', 'Addend'],
    defaults: [1, 0],
    glsl: (a, b, c) => `${a} * ${b} + ${c}`,
    js: (a, b, c) => a * b + c,
  },
  power: {
    label: 'Power',
    group: 'Functions',
    inputs: ['Base', 'Exponent'],
    defaults: [2],
    helper: 'pow',
    glsl: (a, b) => `node_pow(${a}, ${b})`,
    js: computeSafePower,
  },
  logarithm: {
    label: 'Logarithm',
    group: 'Functions',
    inputs: ['Value', 'Base'],
    defaults: [10],
    helper: 'log',
    glsl: (a, b) => `node_log(${a}, ${b})`,
    js: (a, b) => (a > 0 && b > 0 && b !== 1 ? Math.log(a) / Math.log(b) : 0),
  },
  sqrt: { label: 'Square Root', group: 'Functions', inputs: ['Value'], helper: 'sqrt', glsl: (a) => `node_sqrt(${a})`, js: (a) => Math.sqrt(Math.max(a, 0)) },
  inverseSqrt: {
    label: 'Inverse Square Root',
    group: 'Functions',
    inputs: ['Value'],
    helper: 'inversesqrt',
    glsl: (a) => `node_inversesqrt(${a})`,
    js: (a) => (a > 0 ? 1 / Math.sqrt(a) : 0),
  },
  absolute: { label: 'Absolute', group: 'Functions', inputs: ['Value'], glsl: (a) => `abs(${a})`, js: Math.abs },
  exponent: { label: 'Exponent', group: 'Functions', inputs: ['Value'], glsl: (a) => `exp(${a})`, js: Math.exp },

  minimum: { label: 'Minimum', group: 'Comparison', inputs: ['Value', 'Value'], glsl: (a, b) => `min(${a}, ${b})`, js: (a, b) => Math.min(a, b) },
  maximum: { label: 'Maximum', group: 'Comparison', inputs: ['Value', 'Value'], glsl: (a, b) => `max(${a}, ${b})`, js: (a, b) => Math.max(a, b) },
  lessThan: {
    label: 'Less Than',
    group: 'Comparison',
    inputs: ['Value', 'Threshold'],
    glsl: (a, b) => `(1.0 - step(${b}, ${a}))`,
    js: (a, b) => Number(a < b),
  },
  greaterThan: { label: 'Greater Than', group: 'Comparison', inputs: ['Value', 'Threshold'], glsl: (a, b) => `step(${b}, ${a})`, js: (a, b) => Number(a >= b) },
  sign: { label: 'Sign', group: 'Comparison', inputs: ['Value'], glsl: (a) => `sign(${a})`, js: Math.sign },
  compare: {
    label: 'Compare',
    group: 'Comparison',
    inputs: ['Value', 'Value', 'Epsilon'],
    defaults: [0.5, 0.001],
    helper: 'compare',
    glsl: (a, b, c) => `node_compare(${a}, ${b}, ${c})`,
    js: (a, b, c) => Number(Math.abs(a - b) <= c),
  },
  smoothMin: {
    label: 'Smooth Minimum',
    group: 'Comparison',
    inputs: ['Value', 'Value', 'Distance'],
    defaults: [0.5, 0.1],
    helper: 'smoothmin',
    glsl: (a, b, c) => `node_smoothmin(${a}, ${b}, ${c})`,
    js: computeSmoothMin,
  },
  smoothMax: {
    label: 'Smooth Maximum',
    group: 'Comparison',
    inputs: ['Value', 'Value', 'Distance'],
    defaults: [0.5, 0.1],
    helper: 'smoothmax',
    glsl: (a, b, c) => `node_smoothmax(${a}, ${b}, ${c})`,
    js: (a, b, c) => -computeSmoothMin(-a, -b, c),
  },

  round: { label: 'Round', group: 'Rounding', inputs: ['Value'], helper: 'round', glsl: (a) => `node_round(${a})`, js: (a) => Math.floor(a + 0.5) },
  floor: { label: 'Floor', group: 'Rounding', inputs: ['Value'], glsl: (a) => `floor(${a})`, js: Math.floor },
  ceil: { label: 'Ceil', group: 'Rounding', inputs: ['Value'], glsl: (a) => `ceil(${a})`, js: Math.ceil },
  truncate: { label: 'Truncate', group: 'Rounding', inputs: ['Value'], glsl: (a) => `trunc(${a})`, js: Math.trunc },
  fraction: { label: 'Fraction', group: 'Rounding', inputs: ['Value'], glsl: (a) => `fract(${a})`, js: (a) => a - Math.floor(a) },
  modulo: {
    label: 'Modulo',
    group: 'Rounding',
    inputs: ['Value', 'Value'],
    defaults: [1],
    helper: 'modulo',
    glsl: (a, b) => `node_modulo(${a}, ${b})`,
    js: computeModulo,
  },
  flooredModulo: {
    label: 'Floored Modulo',
    group: 'Rounding',
    inputs: ['Value', 'Value'],
    defaults: [1],
    helper: 'floored_modulo',
    glsl: (a, b) => `node_floored_modulo(${a}, ${b})`,
    js: computeFlooredModulo,
  },
  wrap: {
    label: 'Wrap',
    group: 'Rounding',
    inputs: ['Value', 'Min', 'Max'],
    defaults: [0, 1],
    helper: 'wrap',
    glsl: (a, b, c) => `node_wrap(${a}, ${b}, ${c})`,
    js: (a, lo, hi) => (hi - lo === 0 ? lo : a - (hi - lo) * Math.floor((a - lo) / (hi - lo))),
  },
  snap: {
    label: 'Snap',
    group: 'Rounding',
    inputs: ['Value', 'Increment'],
    defaults: [0.1],
    helper: 'snap',
    glsl: (a, b) => `node_snap(${a}, ${b})`,
    js: (a, b) => (b === 0 ? 0 : Math.floor(a / b) * b),
  },
  pingPong: {
    label: 'Ping-Pong',
    group: 'Rounding',
    inputs: ['Value', 'Scale'],
    defaults: [1],
    helper: 'pingpong',
    glsl: (a, b) => `node_pingpong(${a}, ${b})`,
    js: (a, b) => (b === 0 ? 0 : Math.abs((((((a - b) / (b * 2)) % 1) + 1) % 1) * b * 2 - b)),
  },

  sine: { label: 'Sine', group: 'Trigonometric', inputs: ['Value'], glsl: (a) => `sin(${a})`, js: Math.sin },
  cosine: { label: 'Cosine', group: 'Trigonometric', inputs: ['Value'], glsl: (a) => `cos(${a})`, js: Math.cos },
  tangent: { label: 'Tangent', group: 'Trigonometric', inputs: ['Value'], glsl: (a) => `tan(${a})`, js: Math.tan },
  arcsine: {
    label: 'Arcsine',
    group: 'Trigonometric',
    inputs: ['Value'],
    helper: 'asin',
    glsl: (a) => `node_asin(${a})`,
    js: (a) => Math.asin(Math.min(1, Math.max(-1, a))),
  },
  arccosine: {
    label: 'Arccosine',
    group: 'Trigonometric',
    inputs: ['Value'],
    helper: 'acos',
    glsl: (a) => `node_acos(${a})`,
    js: (a) => Math.acos(Math.min(1, Math.max(-1, a))),
  },
  arctangent: { label: 'Arctangent', group: 'Trigonometric', inputs: ['Value'], glsl: (a) => `atan(${a})`, js: Math.atan },
  arctan2: { label: 'Arctan2', group: 'Trigonometric', inputs: ['Value', 'Value'], defaults: [1], glsl: (a, b) => `atan(${a}, ${b})`, js: Math.atan2 },
  sinh: { label: 'Hyperbolic Sine', group: 'Trigonometric', inputs: ['Value'], glsl: (a) => `sinh(${a})`, js: Math.sinh },
  cosh: { label: 'Hyperbolic Cosine', group: 'Trigonometric', inputs: ['Value'], glsl: (a) => `cosh(${a})`, js: Math.cosh },
  tanh: { label: 'Hyperbolic Tangent', group: 'Trigonometric', inputs: ['Value'], glsl: (a) => `tanh(${a})`, js: Math.tanh },

  radians: { label: 'To Radians', group: 'Conversion', inputs: ['Value'], glsl: (a) => `radians(${a})`, js: (a) => (a * Math.PI) / 180 },
  degrees: { label: 'To Degrees', group: 'Conversion', inputs: ['Value'], glsl: (a) => `degrees(${a})`, js: (a) => (a * 180) / Math.PI },
} satisfies Record<string, MathOp>

export type MathOpName = keyof typeof MATH_OPS
const MATH_OP_OPTIONS = Object.entries(MATH_OPS).map(([value, op]) => ({ value: value as MathOpName, label: op.label, group: op.group }))

/** Op decides count and names of the values */
export const mathNode = defineNode('math', ({ op = 'add' }: { op?: MathOpName }) => {
  const operation: MathOp = MATH_OPS[op] ?? MATH_OPS.add
  const [a, b, c] = operation.inputs
  return {
    title: 'Math',
    description:
      "Every operation of Blender's Math node. Pick the operation and the sockets follow: Power takes Base and Exponent, Wrap takes Value, Min and Max. Works on numbers and, per component, on vectors and colors.",
    category: 'converter',
    // Menu entry per op, so "sine" finds Math set to it
    presets: MATH_OP_OPTIONS.map((option) => ({ title: option.label, group: option.group, values: { op: option.value } })),
    input: {
      op: { type: Enum(MATH_OP_OPTIONS), label: '', default: 'add', linkable: false, props: { label: 'Operation' } },
      clamp: { type: Bool, default: false, linkable: false },
      a: { type: GenType, label: a, default: 0.5 },
      ...(b && { b: { type: GenType, label: b, default: operation.defaults?.[0] ?? 0.5 } }),
      ...(c && { c: { type: GenType, label: c, default: operation.defaults?.[1] ?? 0.5 } }),
    },
    output: { result: GenType },
    body: (input, ctx) => {
      if (operation.helper) ctx.include(mathHelper(operation.helper, ctx.gen as MathType))
      const [x, y, z] = [input.a, input.b, input.c].map((value) => value?.expr ?? '0.0')
      const result = operation.glsl(x, y, z)
      return { result: ctx.declare(ctx.gen, input.clamp ? `clamp(${result}, 0.0, 1.0)` : result) }
    },
  }
})
