import { Bool, defineNode, Float } from '@/lib/graph/authoring'

const toBoundSocket = (fallback: number) => ({ type: Float, default: fallback })

export const mapRangeNode = defineNode('remap', {
  title: 'Map Range',
  description: 'Linearly map a value from one range onto another, optionally clamped to the target range.',
  category: 'converter',
  input: {
    clamp: { type: Bool, default: true, linkable: false },
    value: { type: Float, default: { expr: 'uv.x', label: 'uv.x' } },
    inLow: toBoundSocket(0), inHigh: toBoundSocket(1), outLow: toBoundSocket(0), outHigh: toBoundSocket(1),
  },
  output: { result: Float },
  body: ({ clamp, value, inLow, inHigh, outLow, outHigh }, ctx) => {
    const t = `(${value.expr} - ${inLow.expr}) / (${inHigh.expr} - ${inLow.expr})`
    return { result: ctx.declare('float', `mix(${outLow.expr}, ${outHigh.expr}, ${clamp ? `clamp(${t}, 0.0, 1.0)` : t})`) }
  },
})
