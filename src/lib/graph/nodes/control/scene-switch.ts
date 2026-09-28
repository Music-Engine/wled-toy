import { defineNode, Float } from '@/lib/graph/authoring'

export const sceneSwitchNode = defineNode('sceneSwitch', {
  title: 'Scene Switch',
  description:
    'Recalls a saved scene when Index changes: 0 is the first scene in the Parameters panel. Drive it from a Counter to step scenes on the beat, or from MIDI In to pick them from a controller.',
  category: 'input',
  // Unread; acts on the knobs, so it's a sink
  isOutput: true,
  input: {
    index: { type: Float, default: 0, props: { min: 0, step: 1, decimals: 0 } },
    fade: { type: Float, label: 'Fade (s)', default: 0.5, props: { min: 0, step: 0.1, decimals: 2 } },
  },
  output: { scene: Float },
  body: ({ index }, ctx) => ({ scene: ctx.declare('float', `max(0.0, floor(${index.expr} + 0.5))`) }),
  probe: 'scene',
})
