import { defineNode, Float } from '@/lib/graph/authoring'
import { toApproachFraction } from '@/lib/graph/nodes/shared/signal'
import { seconds } from '@/lib/graph/nodes/shared/sockets'

export const envelopeFollowerNode = defineNode('envelopeFollower', {
  title: 'Envelope Follower',
  description: 'Smooths a jumpy signal: rises with Attack, falls with Release (seconds to cover 63% of the way).',
  category: 'signal',
  input: { signal: { type: Float, default: 0 }, attack: seconds(0.01), release: seconds(0.3) },
  output: { envelope: Float },
  state: { value: Float },
  body: ({ signal, attack, release }, ctx) => {
    const { value } = ctx.state
    const time = ctx.declare('float', `${signal.expr} > ${value.expr} ? ${attack.expr} : ${release.expr}`, 'time').expr
    ctx.emit(`${value.expr} += (${signal.expr} - ${value.expr}) * ${toApproachFraction(time)};`)
    return { envelope: value }
  },
})
