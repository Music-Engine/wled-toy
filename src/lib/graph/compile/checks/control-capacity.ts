import { CONTROL_VECTORS } from '@/lib/shader/prelude'
import type { Check } from '@/lib/graph/compile/context'

/** First uniform past `iControl` names its node */
export const checkControlCapacity = (): Check => ({
  name: 'checkControlCapacity',
  reads: ['resources'],
  check: (ctx) => {
    const over = ctx.uniforms[CONTROL_VECTORS * 4]
    return over ? [{ nodeId: over.node, message: 'Too many knobs, MIDI and OSC values reach the shader' }] : []
  },
})
