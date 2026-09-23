import { defineNode } from '@/lib/graph/define/define'
import { Float } from '@/lib/graph/define/socket-types'
import { approach, seconds } from './shared'

export const envelopeFollowerNode = defineNode('envelopeFollower', {
  title: 'Envelope Follower',
  description: 'Smooths a jumpy signal: rises with Attack, falls with Release (seconds to cover 63% of the way).',
  category: 'signal',
  input: { signal: { type: Float, default: 0 }, attack: seconds(0.01), release: seconds(0.3) },
  output: { envelope: Float },
  state: () => ({ value: 0 }),
  run: ({ signal, attack, release }, state, { dt }) => {
    const target = signal
    state.value += (target - state.value) * approach(dt, (target > state.value ? attack : release))
    return { envelope: state.value }
  },
})
