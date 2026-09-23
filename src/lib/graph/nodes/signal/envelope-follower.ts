import { defineNode, Float } from '@/lib/graph/authoring'
import { approach, seconds } from './shared'

export const envelopeFollowerNode = defineNode('envelopeFollower', {
  title: 'Envelope Follower',
  description: 'Smooths a jumpy signal: rises with Attack, falls with Release (seconds to cover 63% of the way).',
  category: 'signal',
  input: { signal: { type: Float, default: 0 }, attack: seconds(0.01), release: seconds(0.3) },
  output: { envelope: Float },
  state: { value: Float },
  frame: ({ signal, attack, release }, { state, dt }) => {
    const target = signal
    state.value += (target - state.value) * approach(dt, (target > state.value ? attack : release))
    return { envelope: state.value }
  },
})
