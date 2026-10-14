import { defineNode, Float } from '@/lib/graph/authoring'

const toRateSocket = (fallback: number) => ({ type: Float, default: fallback, props: { min: 0, step: 0.1, decimals: 2 } })

export const slewLimiterNode = defineNode('slewLimiter', {
  title: 'Slew Limiter',
  description: 'Limits how fast a value may change, in units per second, separately for rising and falling.',
  category: 'signal',
  input: { signal: { type: Float, default: 0 }, rise: toRateSocket(4), fall: toRateSocket(1) },
  output: { value: Float },
  state: { value: Float },
  body: ({ signal, rise, fall }, ctx) => {
    const { value } = ctx.state
    ctx.emit(`${value.expr} += min(${rise.expr} * iTimeDelta, max(-(${fall.expr}) * iTimeDelta, ${signal.expr} - ${value.expr}));`)
    return { value }
  },
})
