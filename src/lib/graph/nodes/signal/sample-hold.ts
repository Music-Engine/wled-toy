import { defineNode, Float } from '@/lib/graph/authoring'
import { risingEdge } from './shared'

export const sampleHoldNode = defineNode('sampleHold', {
  title: 'Sample and Hold',
  description: 'Captures Signal each time Trigger rises past 0.5 and holds it until the next trigger.',
  category: 'signal',
  input: { signal: { type: Float, default: 0 }, trigger: { type: Float, default: 0 } },
  output: { value: Float },
  state: () => ({ held: 0, high: false }),
  frame: ({ signal, trigger }, { state }) => {
    if (risingEdge(state, trigger)) state.held = signal
    return { value: state.held }
  },
})
