import { defineNode, Float, fmt, Int } from '@/lib/graph/authoring'
import { risingEdge, risingEdgeFlag, wrappedCount } from '@/lib/graph/nodes/shared/signal'

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
  state: { count: Float, triggerHigh: Float, resetHigh: Float },
  frameOnlyInOldPipeline: true,
  body: ({ divide, trigger, reset }, ctx) => {
    const { count, triggerHigh, resetHigh } = ctx.state
    const restart = risingEdgeFlag(ctx, resetHigh, reset, 'restart')
    ctx.emit(`if (${restart} > 0.5) ${count.expr} = 0.0;`)
    const up = risingEdgeFlag(ctx, triggerHigh, trigger, 'up')
    const fired = ctx.declare('float', `${up} * float(${count.expr} == 0.0)`, 'fired')
    ctx.emit(`if (${up} > 0.5) ${count.expr} = ${wrappedCount(`${count.expr} + 1.0`, fmt(divide))};`)
    return { trigger: fired, phase: ctx.declare('float', `${count.expr} / ${fmt(divide)}`, 'phase') }
  },
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
