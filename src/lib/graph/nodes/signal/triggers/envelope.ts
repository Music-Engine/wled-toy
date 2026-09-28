import { defineNode, Enum, Float } from '@/lib/graph/authoring'
import { seconds } from '@/lib/graph/nodes/shared/sockets'

const MODES = [{ value: 'adsr', label: 'ADSR (follows the gate)' }, { value: 'ad', label: 'AD (one shot)' }] as const
// Stage slot values
const [IDLE, ATTACK, DECAY, SUSTAIN, RELEASE] = [0, 1, 2, 3, 4]

export const envelopeNode = defineNode('envelope', {
  title: 'Envelope',
  description: 'Shapes a gate into attack, decay, sustain and release. AD fires a full attack and decay on every trigger and ignores how long the gate stays up.',
  category: 'signal',
  input: {
    mode: { type: Enum(MODES), label: '', linkable: false, props: { label: 'Mode' } },
    gate: { type: Float, default: 0 },
    attack: seconds(0.01),
    decay: seconds(0.2),
    sustain: { type: Float, default: 0.5, props: { min: 0, max: 1 } },
    release: seconds(0.4),
  },
  output: { envelope: Float },
  state: { stage: Float, level: Float, high: Float },
  body: ({ mode, gate, attack, decay, sustain, release }, ctx) => {
    const { stage, level, high } = ctx.state
    const [stageNow, levelNow] = [stage.expr, level.expr]
    ctx.emit(`if (${gate.expr} >= 0.5 && ${high.expr} < 0.5) ${stageNow} = ${ATTACK}.0;`)
    if (mode === 'adsr') ctx.emit(`if (${gate.expr} < 0.5 && ${high.expr} >= 0.5 && ${stageNow} != ${IDLE}.0) ${stageNow} = ${RELEASE}.0;`)
    ctx.emit(`${high.expr} = float(${gate.expr} >= 0.5);`)
    const floor = mode === 'adsr' ? sustain.expr : '0.0'
    const toRampStep = (time: string) => `(${time} <= 0.0 ? 1.0 : iTimeDelta / ${time})`
    // One stage step per frame: each line tests the frame's starting stage
    const was = ctx.declare('float', stageNow, 'stage').expr
    ctx.emit(`if (${was} == ${ATTACK}.0) ${levelNow} = min(1.0, ${levelNow} + ${toRampStep(attack.expr)});`)
    ctx.emit(`if (${was} == ${ATTACK}.0 && ${levelNow} >= 1.0) ${stageNow} = ${DECAY}.0;`)
    ctx.emit(`if (${was} == ${DECAY}.0) ${levelNow} = max(${floor}, ${levelNow} - ${toRampStep(decay.expr)});`)
    ctx.emit(`if (${was} == ${DECAY}.0 && ${levelNow} <= ${floor}) ${stageNow} = ${mode === 'adsr' ? SUSTAIN : IDLE}.0;`)
    ctx.emit(`if (${was} == ${SUSTAIN}.0) ${levelNow} = ${floor};`)
    ctx.emit(`if (${was} == ${RELEASE}.0) ${levelNow} = max(0.0, ${levelNow} - ${toRampStep(release.expr)});`)
    ctx.emit(`if (${was} == ${RELEASE}.0 && ${levelNow} <= 0.0) ${stageNow} = ${IDLE}.0;`)
    return { envelope: level }
  },
})
