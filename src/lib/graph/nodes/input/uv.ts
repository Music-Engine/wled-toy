import { defineNode } from '@/lib/graph/define/define'
import { Float, Vec2 } from '@/lib/graph/define/socket-types'
import { swizzle, type Value } from '@/lib/graph/define/value'

const uv: Value = { expr: 'uv', type: 'vec2' }

export const uvNode = defineNode('uv', {
  title: 'UV',
  description: 'Pixel position: uv in 2D, x along the strip, y for the preview row.',
  category: 'input',
  signature: 'vec2 uv',
  input: {},
  output: { uv: { type: Vec2, label: 'UV' }, x: Float, y: Float },
  exec: () => ({ uv, x: swizzle(uv, 'x'), y: swizzle(uv, 'y') }),
})
