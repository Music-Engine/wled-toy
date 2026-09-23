import { Bool, defineNode, Float } from '@/lib/graph/authoring'

const bound = (fallback: number) => ({ type: Float, default: fallback })

export const mapRangeNode = defineNode('remap', {
  title: 'Map Range',
  description: 'Linearly map a value from one range onto another, optionally clamped to the target range.',
  category: 'converter',
  input: {
    clamp: { type: Bool, default: true, connectable: false },
    value: { type: Float, default: { expr: 'uv.x', label: 'uv.x' } },
    inLow: bound(0), inHigh: bound(1), outLow: bound(0), outHigh: bound(1),
  },
  output: { result: Float },
  exec: ({ clamp, value, inLow, inHigh, outLow, outHigh }, ctx) => {
    const t = `(${value.expr} - ${inLow.expr}) / (${inHigh.expr} - ${inLow.expr})`
    return { result: ctx.declare('float', `mix(${outLow.expr}, ${outHigh.expr}, ${clamp ? `clamp(${t}, 0.0, 1.0)` : t})`) }
  },
  run: ({ clamp, value, inLow, inHigh, outLow, outHigh }) => {
    const t = (value - inLow) / (inHigh - inLow)
    return { result: outLow + (outHigh - outLow) * (clamp ? Math.min(1, Math.max(0, t)) : t) }
  },
})
