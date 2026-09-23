import { Bool, defineNode, Float, Int } from '@/lib/graph/authoring'
import { risingEdge } from './shared'

export const clockDividerNode = defineNode('clockDivider', {
  title: 'Clock Divider',
  description: 'Passes every Nth trigger. Feed it the beat to get a bar; Phase counts the triggers in between as 0 to 1.',
  category: 'signal',
  input: {
    divide: { type: Int, default: 4, linkable: false, props: { min: 1, max: 64, step: 1, decimals: 0 } },
    trigger: { type: Float, default: 0 },
    reset: { type: Float, default: 0 },
  },
  output: { trigger: Float, phase: Float },
  state: { count: Int, triggerHigh: Bool, resetHigh: Bool },
  frame: ({ divide, trigger, reset }, { state }) => {
    if (risingEdge(state, 'resetHigh', reset)) state.count = 0
    let fired = 0
    if (risingEdge(state, 'triggerHigh', trigger)) {
      fired = Number(state.count === 0)
      state.count = (state.count + 1) % divide
    }
    return { trigger: fired, phase: state.count / divide }
  },
})
