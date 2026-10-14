import { defineNode, Float, Int, Text } from '@/lib/graph/authoring'
import { clampBetween } from '@/lib/util/math'

export const knobNode = defineNode('knob', {
  title: 'Knob',
  description:
    'A parameter you turn by hand, listed in the Parameters panel under its label. Changing it never recompiles the shader. Bind a MIDI controller to it with Learn.',
  category: 'input',
  input: {
    label: { type: Text, label: 'Name', default: 'Knob', linkable: false },
    value: { type: Float, label: 'Value', default: 0.5, linkable: false, props: (values) => ({ min: values.min ?? 0, max: values.max ?? 1 }) },
    min: { type: Float, default: 0, linkable: false },
    max: { type: Float, default: 1, linkable: false },
    // -1 = unbound; Parameters panel follows this controller
    cc: { type: Int, label: 'MIDI CC (-1 = none)', default: -1, linkable: false, props: { min: -1, max: 127, step: 1, decimals: 0 } },
  },
  output: { value: Float },
  resolve: ({ label, value, min, max, cc }) => ({ uniforms: { value: { kind: 'knob', default: clampBetween(value, min, max), label, min, max, cc } } }),
})
