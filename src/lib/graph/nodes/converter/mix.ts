import { Bool, defineNode, Enum, GenType } from '@/lib/graph/authoring'

const MODES = [
  { value: 'mix', label: 'Mix' },
  { value: 'switch', label: 'Switch' },
] as const

export const mixNode = defineNode('mix', {
  title: 'Mix',
  description: 'Blends A toward B by Factor; Switch picks B once Factor reaches 0.5. Numbers, vectors and colors alike; Color Mix has the blend modes.',
  category: 'converter',
  input: {
    mode: { type: Enum(MODES), label: '', default: 'mix', linkable: false, props: { label: 'Mode' } },
    clampFactor: { type: Bool, default: true, linkable: false },
    factor: { type: GenType, default: { expr: 'uv.x', label: 'uv.x' } },
    a: { type: GenType, label: 'A', default: 0 },
    b: { type: GenType, label: 'B', default: 1 },
  },
  output: { result: GenType },
  body: ({ mode, clampFactor, factor, a, b }, ctx) => {
    const weight = clampFactor ? `clamp(${factor.expr}, 0.0, 1.0)` : factor.expr
    return { result: ctx.declare(ctx.gen, mode === 'switch' ? `mix(${a.expr}, ${b.expr}, step(0.5, ${factor.expr}))` : `mix(${a.expr}, ${b.expr}, ${weight})`) }
  },
})
