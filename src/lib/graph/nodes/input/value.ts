import { defineNode, Float } from '@/lib/graph/authoring'

export const valueNode = defineNode('value', {
  title: 'Value',
  description: 'A constant number.',
  category: 'input',
  signature: 'float value',
  input: {
    value: { type: Float, label: 'Value', default: 0.5, connectable: false },
  },
  output: { value: Float },
  exec: ({ value }) => ({ value: Float.literal(value) }),
})
