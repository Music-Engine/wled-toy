import { defineNode, Float } from '@/lib/graph/authoring'
import { toDecayFactor } from '@/lib/graph/nodes/shared/signal'
import { seconds } from '@/lib/graph/nodes/shared/sockets'

export const peakHoldNode = defineNode('peakHold', {
  title: 'Peak Hold',
  description: 'Jumps to each new peak, holds it, then decays. The falling bar on a VU meter.',
  category: 'signal',
  input: { signal: { type: Float, default: 0 }, hold: seconds(0.2), decay: seconds(0.5) },
  output: { peak: Float },
  state: { value: Float, held: Float },
  body: ({ signal, hold, decay }, ctx) => {
    const { value, held } = ctx.state
    const above = ctx.declare('float', `float(${signal.expr} >= ${value.expr})`, 'above').expr
    ctx.emit(`${held.expr} = ${above} > 0.5 ? 0.0 : ${held.expr} + iTimeDelta;`)
    ctx.emit(`if (${above} < 0.5 && ${held.expr} > ${hold.expr}) ${value.expr} = max(${signal.expr}, ${value.expr} * ${toDecayFactor(decay.expr)});`)
    ctx.emit(`if (${above} > 0.5) ${value.expr} = ${signal.expr};`)
    return { peak: value }
  },
})
