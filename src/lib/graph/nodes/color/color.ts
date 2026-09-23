import { defineNode } from '@/lib/graph/define/define'
import { Color } from '@/lib/graph/define/socket-types'

export const colorNode = defineNode('color', {
  title: 'Color',
  description: 'A constant RGB color.',
  category: 'color',
  signature: 'vec3 color',
  input: {
    color: { type: Color, label: '', default: [1, 0.45, 0.1], connectable: false },
  },
  output: { color: Color },
  exec: ({ color }) => ({ color: Color.literal(color) }),
})
