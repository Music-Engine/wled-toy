import { defineNode, Enum, GenType } from '@/lib/graph/authoring'

const TYPES = [{ value: 'minMax', label: 'Min Max' }, { value: 'range', label: 'Range' }] as const

export const clampNode = defineNode('clamp', {
  title: 'Clamp',
  description: 'Constrain a value between two bounds. Range accepts the bounds in either order.',
  category: 'converter',
  input: {
    type: { type: Enum(TYPES), label: '', linkable: false, props: { label: 'Clamp' } },
    value: { type: GenType, default: { expr: 'uv.x', label: 'uv.x' } },
    min: { type: GenType, default: 0 },
    max: { type: GenType, default: 1 },
  },
  output: { result: GenType },
  body: ({ type, value, min, max }, ctx) => ({
    result: ctx.declare(ctx.gen, type === 'range'
      ? `clamp(${value.expr}, min(${min.expr}, ${max.expr}), max(${min.expr}, ${max.expr}))`
      : `clamp(${value.expr}, ${min.expr}, ${max.expr})`),
  }),
  frame: ({ type, value, min, max }) => {
    const clamp = (v: number, a: number, b: number) => (type === 'range' ? Math.min(Math.max(a, b), Math.max(Math.min(a, b), v)) : Math.min(b, Math.max(a, v)))
    // all three arrive cast to the same width
    return { result: Array.isArray(value) ? value.map((v, i) => clamp(v, (min as number[])[i], (max as number[])[i])) : clamp(value, min as number, max as number) }
  },
})
