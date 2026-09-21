import { defineNode } from '@/lib/graph/define/define'
import { Float, Text } from '@/lib/graph/define/types'
import { risingEdge } from './shared'

const parse = (steps: string) => steps.split(/[\s,]+/).map(Number).filter(Number.isFinite)

export const stepSequencerNode = defineNode('stepSequencer', {
  title: 'Step Sequencer',
  description: 'A list of values, one per trigger: "1 0 0.5 0" gives four steps. Each trigger moves to the next value and wraps around; Reset goes back to the first.',
  category: 'signal',
  input: {
    steps: { type: Text, label: 'Steps', default: '1 0 0.5 0', connectable: false, props: { placeholder: '1 0 0.5 0' } },
    trigger: { type: Float, default: 0 },
    reset: { type: Float, default: 0 },
  },
  output: { value: Float, step: Float },
  state: () => ({ index: 0, trigger: { high: false }, reset: { high: false }, steps: '', values: [] as number[] }),
  run: ({ steps, trigger, reset }, state) => {
    if (steps !== state.steps) Object.assign(state, { steps, values: parse(steps) })
    const { values } = state
    if (risingEdge(state.reset, reset)) state.index = 0
    else if (risingEdge(state.trigger, trigger)) state.index += 1
    if (!values.length) return { value: 0, step: 0 }
    state.index %= values.length
    return { value: values[state.index], step: state.index }
  },
})
