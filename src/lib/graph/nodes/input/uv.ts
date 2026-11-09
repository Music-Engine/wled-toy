import { defineNode, Float, swizzle, Vec2, type Value } from '@/lib/graph/authoring'

const uv: Value = { expr: 'uv', type: 'vec2' }

export const uvNode = defineNode('uv', {
  title: 'UV',
  description: 'Pixel position: uv in 2D, x along the strip, y for the preview row.',
  category: 'input',
  varies: 'pixel',
  signature: 'vec2 uv',
  input: {},
  output: { uv: { type: Vec2, label: 'UV' }, x: Float, y: Float },
  body: () => ({ uv, x: swizzle(uv, 'x'), y: swizzle(uv, 'y') }),
})
