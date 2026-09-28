import { defineNode, Float, floatLiteral, fmt, Text } from '@/lib/graph/authoring'
import { declareRisingEdge, wrapCount } from '@/lib/graph/nodes/shared/signal'

const parseSteps = (steps: string) => steps.split(/[\s,]+/).map(Number).filter(Number.isFinite)

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
  resolve: ({ steps }) => ({ data: { values: parseSteps(steps) } }),
  body: ({ trigger, reset }, ctx) => {
    const values = ctx.resolved.values as number[]
    const { index, triggerHigh, resetHigh } = ctx.state
    const restart = declareRisingEdge(ctx, resetHigh, reset, 'restart')
    // Trigger edge counts only w/o a Reset rise, so a trigger held through reset counts after it
    const up = ctx.declare('float', `(1.0 - ${restart}) * float(${trigger.expr} >= 0.5 && ${triggerHigh.expr} < 0.5)`, 'up').expr
    ctx.emit(`if (${restart} < 0.5) ${triggerHigh.expr} = float(${trigger.expr} >= 0.5);`)
    ctx.emit(`${index.expr} = ${restart} > 0.5 ? 0.0 : ${index.expr} + ${up};`)
    if (!values.length) return { value: floatLiteral(0), step: floatLiteral(0) }
    ctx.emit(`${index.expr} = ${wrapCount(index.expr, fmt(values.length))};`)
    return { value: ctx.declare('float', selectStepValue(index.expr, values), 'value'), step: index }
  },
})

/** Chain of selects: GLSL ES and the C++ header share no array literal */
const selectStepValue = (index: string, values: number[]) =>
  values.slice(0, -1).reduceRight((rest, value, i) => `${index} < ${fmt(i + 0.5)} ? ${fmt(value)} : ${rest}`, fmt(values[values.length - 1]))
