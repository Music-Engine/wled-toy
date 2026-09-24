import { Bool, defineNode, Float } from '@/lib/graph/authoring'
import { risingEdge } from '@/lib/graph/nodes/shared/signal'

export const sampleHoldNode = defineNode('sampleHold', {
  title: 'Sample and Hold',
  description: 'Captures Signal each time Trigger rises past 0.5 and holds it until the next trigger.',
  category: 'signal',
  input: { signal: { type: Float, default: 0 }, trigger: { type: Float, default: 0 } },
  output: { value: Float },
  state: { held: Float, high: Bool },
  frame: ({ signal, trigger }, { state }) => {
    if (risingEdge(state, 'high', trigger)) state.held = signal
    return { value: state.held }
  },
})
