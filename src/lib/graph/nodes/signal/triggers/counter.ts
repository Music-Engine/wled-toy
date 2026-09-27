import { Bool, defineNode, Float, Int } from '@/lib/graph/authoring'
import { risingEdge } from '@/lib/graph/nodes/shared/signal'

export const counterNode = defineNode('counter', {
  title: 'Counter',
  description: 'Counts triggers and wraps at Steps. Phase is the count as 0 to 1, handy for stepping through a palette.',
  category: 'signal',
  input: {
    steps: { type: Int, default: 4, linkable: false, props: { min: 1, step: 1, decimals: 0 } },
    trigger: { type: Float, default: 0 },
    reset: { type: Float, default: 0 },
  },
  output: { count: Float, phase: Float },
  state: { count: Int, triggerHigh: Bool, resetHigh: Bool },
  frame: ({ steps, trigger, reset }, { state }) => {
    if (risingEdge(state, 'triggerHigh', trigger)) state.count = (state.count + 1) % steps
    if (risingEdge(state, 'resetHigh', reset)) state.count = 0
    return { count: state.count, phase: state.count / steps }
  },
})

export const toggleNode = defineNode('toggle', {
  title: 'Toggle',
  description: 'Flips between 0 and 1 on every trigger.',
  category: 'signal',
  input: { trigger: { type: Float, default: 0 } },
  output: { state: Float },
  state: { on: Bool, high: Bool },
  frame: ({ trigger }, { state }) => {
    if (risingEdge(state, 'high', trigger)) state.on = !state.on
    return { state: state.on ? 1 : 0 }
  },
})
