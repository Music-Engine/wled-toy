import { Bool, defineNode, Float } from '@/lib/graph/authoring'

export const rangeSelectNode = defineNode('rangeSelect', {
  title: 'Range Select',
  description: 'A mask that is 1 from From to To and 0 outside, with Softness as the width of the edges. Use positions (0 to 1) or, fed the LED index, LED numbers.',
  category: 'math',
  input: {
    invert: { type: Bool, default: false, linkable: false },
    value: { type: Float, default: { expr: 'uv.x', label: 'uv.x' } },
    from: { type: Float, default: 0.25, props: { decimals: 3 } },
    to: { type: Float, default: 0.75, props: { decimals: 3 } },
    softness: { type: Float, default: 0, props: { min: 0, decimals: 3 } },
  },
  output: { mask: Float },
  pixel: ({ invert, value, from, to, softness }, ctx) => {
    const edge = ctx.declare('float', `max(${softness.expr}, 0.0001) * 0.5`, 'edge').expr
    const lo = ctx.declare('float', `min(${from.expr}, ${to.expr})`, 'lo').expr
    const hi = ctx.declare('float', `max(${from.expr}, ${to.expr})`, 'hi').expr
    const mask = `smoothstep(${lo} - ${edge}, ${lo} + ${edge}, ${value.expr}) * (1.0 - smoothstep(${hi} - ${edge}, ${hi} + ${edge}, ${value.expr}))`
    return { mask: ctx.declare('float', invert ? `1.0 - ${mask}` : mask) }
  },
})
