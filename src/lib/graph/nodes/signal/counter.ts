import { defineNode } from '@/lib/graph/define/define'
import { Float, Int } from '@/lib/graph/define/socket-types'
import { risingEdge } from './shared'

export const counterNode = defineNode('counter', {
  title: 'Counter',
  description: 'Counts triggers and wraps at Steps. Phase is the count as 0 to 1, handy for stepping through a palette.',
  category: 'signal',
  input: {
    steps: { type: Int, default: 4, connectable: false, props: { min: 1, step: 1, decimals: 0 } },
    trigger: { type: Float, default: 0 },
    reset: { type: Float, default: 0 },
  },
  output: { count: Float, phase: Float },
  state: () => ({ count: 0, trigger: { high: false }, reset: { high: false } }),
  run: ({ steps, trigger, reset }, state) => {
    if (risingEdge(state.trigger, trigger)) state.count = (state.count + 1) % steps
    if (risingEdge(state.reset, reset)) state.count = 0
    return { count: state.count, phase: state.count / steps }
  },
})

export const toggleNode = defineNode('toggle', {
  title: 'Toggle',
  description: 'Flips between 0 and 1 on every trigger.',
  category: 'signal',
  input: { trigger: { type: Float, default: 0 } },
  output: { state: Float },
  state: () => ({ on: false, high: false }),
  run: ({ trigger }, state) => {
    if (risingEdge(state, trigger)) state.on = !state.on
    return { state: state.on ? 1 : 0 }
  },
})
