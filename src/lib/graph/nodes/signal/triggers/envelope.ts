import { defineNode, Enum, Float } from '@/lib/graph/authoring'
import { seconds } from '@/lib/graph/nodes/shared/sockets'

const MODES = [{ value: 'adsr', label: 'ADSR (follows the gate)' }, { value: 'ad', label: 'AD (one shot)' }] as const
// the stages, as the numbers the stage slot holds
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
  frameOnlyInOldPipeline: true,
  body: ({ mode, gate, attack, decay, sustain, release }, ctx) => {
    const { stage, level, high } = ctx.state
    const [s, l] = [stage.expr, level.expr]
    ctx.emit(`if (${gate.expr} >= 0.5 && ${high.expr} < 0.5) ${s} = ${ATTACK}.0;`)
    if (mode === 'adsr') ctx.emit(`if (${gate.expr} < 0.5 && ${high.expr} >= 0.5 && ${s} != ${IDLE}.0) ${s} = ${RELEASE}.0;`)
    ctx.emit(`${high.expr} = float(${gate.expr} >= 0.5);`)
    const floor = mode === 'adsr' ? sustain.expr : '0.0'
    const ramp = (time: string) => `(${time} <= 0.0 ? 1.0 : iTimeDelta / ${time})`
    // one stage steps per frame: each line tests the stage the frame started in
    const was = ctx.declare('float', s, 'stage').expr
    ctx.emit(`if (${was} == ${ATTACK}.0) ${l} = min(1.0, ${l} + ${ramp(attack.expr)});`)
    ctx.emit(`if (${was} == ${ATTACK}.0 && ${l} >= 1.0) ${s} = ${DECAY}.0;`)
    ctx.emit(`if (${was} == ${DECAY}.0) ${l} = max(${floor}, ${l} - ${ramp(decay.expr)});`)
    ctx.emit(`if (${was} == ${DECAY}.0 && ${l} <= ${floor}) ${s} = ${mode === 'adsr' ? SUSTAIN : IDLE}.0;`)
    ctx.emit(`if (${was} == ${SUSTAIN}.0) ${l} = ${floor};`)
    ctx.emit(`if (${was} == ${RELEASE}.0) ${l} = max(0.0, ${l} - ${ramp(release.expr)});`)
    ctx.emit(`if (${was} == ${RELEASE}.0 && ${l} <= 0.0) ${s} = ${IDLE}.0;`)
    return { envelope: level }
  },
  frame: ({ mode, gate, attack, decay, sustain, release }, { state, dt }) => {
    const high = gate >= 0.5
    if (high && !state.high) state.stage = ATTACK
    if (!high && state.high && mode === 'adsr' && state.stage !== IDLE) state.stage = RELEASE
    state.high = Number(high)

    const floor = mode === 'adsr' ? sustain : 0
    // linear segments: each time is how long a full 0 to 1 sweep takes
    const ramp = (time: number) => (time <= 0 ? 1 : dt / time)
    if (state.stage === ATTACK) {
      state.level = Math.min(1, state.level + ramp(attack))
      if (state.level >= 1) state.stage = DECAY
    } else if (state.stage === DECAY) {
      state.level = Math.max(floor, state.level - ramp(decay))
      if (state.level <= floor) state.stage = mode === 'adsr' ? SUSTAIN : IDLE
    } else if (state.stage === SUSTAIN) {
      state.level = floor
    } else if (state.stage === RELEASE) {
      state.level = Math.max(0, state.level - ramp(release))
      if (state.level <= 0) state.stage = IDLE
    }
    return { envelope: state.level }
  },
})
