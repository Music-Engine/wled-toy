import { defineNode, Enum, Float } from '@/lib/graph/authoring'
import { seconds } from './shared'

const MODES = [{ value: 'adsr', label: 'ADSR (follows the gate)' }, { value: 'ad', label: 'AD (one shot)' }] as const

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
  state: () => ({ stage: 'idle' as 'idle' | 'attack' | 'decay' | 'sustain' | 'release', level: 0, high: false }),
  run: ({ mode, gate, attack, decay, sustain, release }, state, { dt }) => {
    const high = gate >= 0.5
    if (high && !state.high) state.stage = 'attack'
    if (!high && state.high && mode === 'adsr' && state.stage !== 'idle') state.stage = 'release'
    state.high = high

    const floor = mode === 'adsr' ? sustain : 0
    // linear segments: each time is how long a full 0 to 1 sweep takes
    const ramp = (time: number) => (time <= 0 ? 1 : dt / time)
    if (state.stage === 'attack') {
      state.level = Math.min(1, state.level + ramp(attack))
      if (state.level >= 1) state.stage = 'decay'
    } else if (state.stage === 'decay') {
      state.level = Math.max(floor, state.level - ramp(decay))
      if (state.level <= floor) state.stage = mode === 'adsr' ? 'sustain' : 'idle'
    } else if (state.stage === 'sustain') {
      state.level = floor
    } else if (state.stage === 'release') {
      state.level = Math.max(0, state.level - ramp(release))
      if (state.level <= 0) state.stage = 'idle'
    }
    return { envelope: state.level }
  },
})
