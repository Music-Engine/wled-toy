import { defineNode, Float } from '@/lib/graph/authoring'

export const sceneSwitchNode = defineNode('sceneSwitch', {
  title: 'Scene Switch',
  description: 'Recalls a saved scene when Index changes: 0 is the first scene in the Parameters panel. Drive it from a Counter to step scenes on the beat, or from MIDI In to pick them from a controller.',
  category: 'input',
  // nothing reads this node; it acts on the knobs, so it is evaluated even though no link leads from it to the Output
  isOutput: true,
  input: {
    index: { type: Float, default: 0, props: { min: 0, step: 1, decimals: 0 } },
    fade: { type: Float, label: 'Fade (s)', default: 0.5, props: { min: 0, step: 0.1, decimals: 2 } },
  },
  output: { scene: Float },
  frame: ({ index }) => ({ scene: Math.max(0, Math.round(index)) }),
})
