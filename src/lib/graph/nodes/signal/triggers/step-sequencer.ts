import { defineNode, Float, floatLiteral, fmt, Text } from '@/lib/graph/authoring'
import { risingEdge, risingEdgeFlag, wrappedCount } from '@/lib/graph/nodes/shared/signal'

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
  state: { index: Float, triggerHigh: Float, resetHigh: Float },
  resolve: ({ steps }) => ({ data: { values: parse(steps) } }),
  body: ({ trigger, reset }, ctx) => {
    const values = ctx.resolved.values as number[]
    const { index, triggerHigh, resetHigh } = ctx.state
    const restart = risingEdgeFlag(ctx, resetHigh, reset, 'restart')
    // the trigger's edge is only looked at when Reset did not rise, so a trigger held through a reset counts after it
    const up = ctx.declare('float', `(1.0 - ${restart}) * float(${trigger.expr} >= 0.5 && ${triggerHigh.expr} < 0.5)`, 'up').expr
    ctx.emit(`if (${restart} < 0.5) ${triggerHigh.expr} = float(${trigger.expr} >= 0.5);`)
    ctx.emit(`${index.expr} = ${restart} > 0.5 ? 0.0 : ${index.expr} + ${up};`)
    if (!values.length) return { value: floatLiteral(0), step: floatLiteral(0) }
    ctx.emit(`${index.expr} = ${wrappedCount(index.expr, fmt(values.length))};`)
    return { value: ctx.declare('float', stepValue(index.expr, values), 'value'), step: index }
  },
  frame: ({ trigger, reset }, { state, resolved }) => {
    const values = resolved.values as number[]
    if (risingEdge(state, 'resetHigh', reset)) state.index = 0
    else if (risingEdge(state, 'triggerHigh', trigger)) state.index += 1
    if (!values.length) return { value: 0, step: 0 }
    state.index %= values.length
    return { value: values[state.index], step: state.index }
  },
})

/** The value at a whole-number `index`, as a chain of selects; neither GLSL ES nor the C++ header share an array literal. */
const stepValue = (index: string, values: number[]) =>
  values.slice(0, -1).reduceRight((rest, value, i) => `${index} < ${fmt(i + 0.5)} ? ${fmt(value)} : ${rest}`, fmt(values[values.length - 1]))
