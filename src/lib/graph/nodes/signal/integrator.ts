import { Bool, defineNode, Float } from '@/lib/graph/authoring'
import { declareRisingEdge } from '@/lib/graph/nodes/shared/signal'

export const integratorNode = defineNode('integrator', {
  title: 'Integrator',
  description: 'Adds Rate times the frame time every frame: a phase that keeps turning at whatever speed Rate has now. Drive a texture or a wave with it instead of Time times a speed, and changing the speed no longer jumps.',
  category: 'signal',
  input: {
    wrap: { type: Bool, default: true, linkable: false },
    rate: { type: Float, default: 1, props: { step: 0.1, decimals: 3 } },
    reset: { type: Float, default: 0 },
  },
  output: { value: Float },
  state: { value: Float, high: Float },
  body: ({ wrap, rate, reset }, ctx) => {
    const { value, high } = ctx.state
    const restart = declareRisingEdge(ctx, high, reset, 'restart')
    ctx.emit(`${value.expr} = (${restart} > 0.5 ? 0.0 : ${value.expr}) + ${rate.expr} * iTimeDelta;`)
    if (wrap) ctx.emit(`${value.expr} = fract(${value.expr});`)
    return { value }
  },
})
