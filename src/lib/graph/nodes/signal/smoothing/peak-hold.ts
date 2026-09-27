import { defineNode, Float } from '@/lib/graph/authoring'
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
    ctx.emit(`if (${above} < 0.5 && ${held.expr} > ${hold.expr}) ${value.expr} = max(${signal.expr}, ${value.expr} * exp(-iTimeDelta / max(${decay.expr}, 0.0001)));`)
    ctx.emit(`if (${above} > 0.5) ${value.expr} = ${signal.expr};`)
    return { peak: value }
  },
  frame: ({ signal, hold, decay }, { state, dt }) => {
    const level = signal
    if (level >= state.value) {
      state.value = level
      state.held = 0
    } else if ((state.held += dt) > hold) {
      state.value = Math.max(level, state.value * Math.exp(-dt / Math.max(decay, 1e-4)))
    }
    return { peak: state.value }
  },
})
