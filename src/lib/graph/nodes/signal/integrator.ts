import { Bool, defineNode, Float } from '@/lib/graph/authoring'
import { risingEdge } from './shared'

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
  state: { value: Float, high: Bool },
  frame: ({ wrap, rate, reset }, { state, dt }) => {
    if (risingEdge(state, 'high', reset)) state.value = 0
    state.value += rate * dt
    // wrapped, it stays a 0 to 1 phase however long it runs
    if (wrap) state.value -= Math.floor(state.value)
    return { value: state.value }
  },
})
