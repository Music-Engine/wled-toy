import { defineNode } from '@/lib/graph/define/define'
import { Float } from '@/lib/graph/define/socket-types'

const rate = (fallback: number) => ({ type: Float, default: fallback, props: { min: 0, step: 0.1, decimals: 2 } })

export const slewLimiterNode = defineNode('slewLimiter', {
  title: 'Slew Limiter',
  description: 'Limits how fast a value may change, in units per second, separately for rising and falling.',
  category: 'signal',
  input: { signal: { type: Float, default: 0 }, rise: rate(4), fall: rate(1) },
  output: { value: Float },
  state: () => ({ value: 0 }),
  run: ({ signal, rise, fall }, state, { dt }) => {
    const change = signal - state.value
    state.value += Math.min(rise * dt, Math.max(-fall * dt, change))
    return { value: state.value }
  },
})
