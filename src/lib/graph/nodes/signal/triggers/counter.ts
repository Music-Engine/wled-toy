import { defineNode, Float, fmt, Int } from '@/lib/graph/authoring'
import { risingEdge, risingEdgeFlag, wrappedCount } from '@/lib/graph/nodes/shared/signal'

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
  state: { count: Float, triggerHigh: Float, resetHigh: Float },
  frameOnlyInOldPipeline: true,
  body: ({ steps, trigger, reset }, ctx) => {
    const { count, triggerHigh, resetHigh } = ctx.state
    const up = risingEdgeFlag(ctx, triggerHigh, trigger, 'up')
    const restart = risingEdgeFlag(ctx, resetHigh, reset, 'restart')
    ctx.emit(`if (${up} > 0.5) ${count.expr} = ${wrappedCount(`${count.expr} + 1.0`, fmt(steps))};`)
    ctx.emit(`if (${restart} > 0.5) ${count.expr} = 0.0;`)
    return { count, phase: ctx.declare('float', `${count.expr} / ${fmt(steps)}`, 'phase') }
  },
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
  state: { on: Float, high: Float },
  frameOnlyInOldPipeline: true,
  body: ({ trigger }, ctx) => {
    const { on, high } = ctx.state
    ctx.emit(`if (${risingEdgeFlag(ctx, high, trigger, 'flip')} > 0.5) ${on.expr} = 1.0 - ${on.expr};`)
    return { state: on }
  },
  frame: ({ trigger }, { state }) => {
    if (risingEdge(state, 'high', trigger)) state.on = 1 - state.on
    return { state: state.on }
  },
})
