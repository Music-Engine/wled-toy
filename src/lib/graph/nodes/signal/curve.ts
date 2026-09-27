import { defineNode, Enum, Float } from '@/lib/graph/authoring'

// each curve maps 0..1 to 0..1; `glsl` and `js` are the same formula in both languages
const CURVES = [
  { value: 'smooth', label: 'Ease In Out', glsl: (t: string) => `${t} * ${t} * (3.0 - 2.0 * ${t})`, js: (t: number) => t * t * (3 - 2 * t) },
  { value: 'easeIn', label: 'Ease In', glsl: (t: string) => `${t} * ${t}`, js: (t: number) => t * t },
  { value: 'easeOut', label: 'Ease Out', glsl: (t: string) => `1.0 - (1.0 - ${t}) * (1.0 - ${t})`, js: (t: number) => 1 - (1 - t) * (1 - t) },
  { value: 'cubicIn', label: 'Cubic In', glsl: (t: string) => `${t} * ${t} * ${t}`, js: (t: number) => t ** 3 },
  { value: 'cubicOut', label: 'Cubic Out', glsl: (t: string) => `1.0 - pow(1.0 - ${t}, 3.0)`, js: (t: number) => 1 - (1 - t) ** 3 },
  { value: 'sine', label: 'Sine', glsl: (t: string) => `0.5 - 0.5 * cos(3.14159265 * ${t})`, js: (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t) },
  { value: 'exponential', label: 'Exponential', glsl: (t: string) => `(exp2(10.0 * ${t}) - 1.0) / 1023.0`, js: (t: number) => (2 ** (10 * t) - 1) / 1023 },
  { value: 'bounce', label: 'Bounce', glsl: (t: string) => `abs(sin(3.14159265 * ${t} * 2.5)) * ${t}`, js: (t: number) => Math.abs(Math.sin(Math.PI * t * 2.5)) * t },
] as const

export const curveNode = defineNode('curve', {
  title: 'Curve',
  description: 'Reshape a 0 to 1 value with an easing curve. The input is clamped first.',
  category: 'converter',
  input: {
    curve: { type: Enum(CURVES), label: '', linkable: false, props: { label: 'Curve' } },
    value: { type: Float, default: { expr: 'uv.x', label: 'uv.x' } },
  },
  output: { result: Float },
  body: ({ curve, value }, ctx) => {
    const t = ctx.declare('float', `clamp(${value.expr}, 0.0, 1.0)`, 't').expr
    return { result: ctx.declare('float', CURVES.find((c) => c.value === curve)!.glsl(t)) }
  },
  frame: ({ curve, value }) => ({ result: CURVES.find((c) => c.value === curve)!.js(Math.min(1, Math.max(0, value))) }),
})
