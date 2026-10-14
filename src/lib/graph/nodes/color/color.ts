import { Color, defineNode, vectorLiteral } from '@/lib/graph/authoring'

export const colorNode = defineNode('color', {
  title: 'Color',
  description: 'A constant RGB color.',
  category: 'color',
  signature: 'vec3 color',
  input: {
    color: { type: Color, label: '', default: [1, 0.45, 0.1], linkable: false },
  },
  output: { color: Color },
  body: ({ color }) => ({ color: vectorLiteral(color) }),
})
