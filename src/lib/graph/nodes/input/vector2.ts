import { defineNode, Vec2 } from '@/lib/graph/authoring'

export const vector2Node = defineNode('vector2', {
  title: 'Vector 2',
  description: 'A constant 2D vector.',
  category: 'input',
  signature: 'vec2 vector',
  input: {
    vector: { type: Vec2, label: '', default: [0.5, 0.5], connectable: false },
  },
  output: { vector: Vec2 },
  exec: ({ vector }) => ({ vector: Vec2.literal(vector) }),
})
