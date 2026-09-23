import { defineNode } from '@/lib/graph/define/define'
import { Float, Int, Text } from '@/lib/graph/define/socket-types'

export const knobNode = defineNode('knob', {
  title: 'Knob',
  description: 'A parameter you turn by hand, listed in the Parameters panel under its label. Changing it never recompiles the shader. Bind a MIDI controller to it with Learn.',
  category: 'input',
  input: {
    label: { type: Text, label: 'Name', default: 'Knob', connectable: false },
    value: { type: Float, label: 'Value', default: 0.5, connectable: false, props: (values) => ({ min: values.min ?? 0, max: values.max ?? 1 }) },
    min: { type: Float, default: 0, connectable: false },
    max: { type: Float, default: 1, connectable: false },
    // -1 is unbound; the Parameters panel moves the value when this controller moves
    cc: { type: Int, label: 'MIDI CC (-1 = none)', default: -1, connectable: false, props: { min: -1, max: 127, step: 1, decimals: 0 } },
  },
  output: { value: Float },
  run: ({ value, min, max }) => ({ value: Math.min(Math.max(min, max), Math.max(Math.min(min, max), value)) }),
})
