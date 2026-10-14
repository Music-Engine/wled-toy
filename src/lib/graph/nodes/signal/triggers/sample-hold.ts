import { defineNode, Float } from '@/lib/graph/authoring'
import { declareRisingEdge } from '@/lib/graph/nodes/shared/signal'

export const sampleHoldNode = defineNode('sampleHold', {
  title: 'Sample and Hold',
  description: 'Captures Signal each time Trigger rises past 0.5 and holds it until the next trigger.',
  category: 'signal',
  input: { signal: { type: Float, default: 0 }, trigger: { type: Float, default: 0 } },
  output: { value: Float },
  state: { held: Float, high: Float },
  body: ({ signal, trigger }, ctx) => {
    const { held, high } = ctx.state
    const rose = declareRisingEdge(ctx, high, trigger, 'rose')
    ctx.emit(`if (${rose} > 0.5) ${held.expr} = ${signal.expr};`)
    return { value: held }
  },
})
