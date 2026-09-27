import { Bool, defineNode, Float, Int, Text } from '@/lib/graph/authoring'
import { risingEdge } from '@/lib/graph/nodes/shared/signal'

const parse = (steps: string) => steps.split(/[\s,]+/).map(Number).filter(Number.isFinite)

export const stepSequencerNode = defineNode('stepSequencer', {
  title: 'Step Sequencer',
  description: 'A list of values, one per trigger: "1 0 0.5 0" gives four steps. Each trigger moves to the next value and wraps around; Reset goes back to the first.',
  category: 'signal',
  input: {
    steps: { type: Text, label: 'Steps', default: '1 0 0.5 0', linkable: false, props: { placeholder: '1 0 0.5 0' } },
    trigger: { type: Float, default: 0 },
    reset: { type: Float, default: 0 },
  },
  output: { value: Float, step: Float },
  state: { index: Int, triggerHigh: Bool, resetHigh: Bool },
  resolve: ({ steps }) => ({ data: { values: parse(steps) } }),
  frame: ({ trigger, reset }, { state, resolved }) => {
    const values = resolved.values as number[]
    if (risingEdge(state, 'resetHigh', reset)) state.index = 0
    else if (risingEdge(state, 'triggerHigh', trigger)) state.index += 1
    if (!values.length) return { value: 0, step: 0 }
    state.index %= values.length
    return { value: values[state.index], step: state.index }
  },
})
