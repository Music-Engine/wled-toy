import { defineNode, Float } from '@/lib/graph/authoring'
import { seconds } from './shared'

export const peakHoldNode = defineNode('peakHold', {
  title: 'Peak Hold',
  description: 'Jumps to each new peak, holds it, then decays. The falling bar on a VU meter.',
  category: 'signal',
  input: { signal: { type: Float, default: 0 }, hold: seconds(0.2), decay: seconds(0.5) },
  output: { peak: Float },
  state: () => ({ value: 0, held: 0 }),
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
