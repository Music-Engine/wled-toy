import { defineNode, Float } from '@/lib/graph/authoring'

export const fromCenterNode = defineNode('fromCenter', {
  title: 'Distance From Center',
  description: '0 at the center, 1 at whichever end is further away. Feed it a position for effects that grow outward from the middle of the strip.',
  category: 'math',
  varies: 'pixel',
  input: {
    position: { type: Float, default: { expr: 'uv.x', label: 'uv.x' } },
    center: { type: Float, default: 0.5, props: { decimals: 3 } },
  },
  output: { distance: Float },
  body: ({ position, center }, ctx) => ({ distance: ctx.declare('float', `abs(${position.expr} - ${center.expr}) / max(max(${center.expr}, 1.0 - ${center.expr}), 0.0001)`) }),
})
