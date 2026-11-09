import { defineNode, Float } from '@/lib/graph/authoring'

const toLevelSocket = (fallback: number) => ({ type: Float, default: fallback, props: { decimals: 3 } })

export const schmittTriggerNode = defineNode('schmittTrigger', {
  title: 'Threshold',
  description: 'Turns on above High and off below Low. The gap between them stops a noisy signal from chattering.',
  category: 'signal',
  input: { signal: { type: Float, default: 0 }, low: toLevelSocket(0.4), high: toLevelSocket(0.6) },
  output: { gate: Float },
  state: { on: Float },
  body: ({ signal, low, high }, ctx) => {
    const { on } = ctx.state
    ctx.emit(`${on.expr} = ${on.expr} > 0.5 ? float(${signal.expr} > ${low.expr}) : float(${signal.expr} >= ${high.expr});`)
    return { gate: on }
  },
})
