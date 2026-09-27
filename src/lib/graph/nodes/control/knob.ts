import { defineNode, Float, Int, Text } from '@/lib/graph/authoring'

export const knobNode = defineNode('knob', {
  title: 'Knob',
  description: 'A parameter you turn by hand, listed in the Parameters panel under its label. Changing it never recompiles the shader. Bind a MIDI controller to it with Learn.',
  category: 'input',
  input: {
    label: { type: Text, label: 'Name', default: 'Knob', linkable: false },
    value: { type: Float, label: 'Value', default: 0.5, linkable: false, props: (values) => ({ min: values.min ?? 0, max: values.max ?? 1 }) },
    min: { type: Float, default: 0, linkable: false },
    max: { type: Float, default: 1, linkable: false },
    // -1 is unbound; the Parameters panel moves the value when this controller moves
    cc: { type: Int, label: 'MIDI CC (-1 = none)', default: -1, linkable: false, props: { min: -1, max: 127, step: 1, decimals: 0 } },
  },
  output: { value: Float },
  frame: ({ value, min, max }) => ({ value: Math.min(Math.max(min, max), Math.max(Math.min(min, max), value)) }),
})
