import { defineNode } from '@/lib/graph/define/define'
import { Float, Vec2, Vec3 } from '@/lib/graph/define/socket-types'
import { swizzle } from '@/lib/graph/define/value'

export const ledLayoutNode = defineNode('ledLayout', {
  title: 'LED Layout',
  description: 'Where the LED being shaded physically is, from the layout in Settings: a strip, ring, matrix or measured points. In the 2D preview it is the pixel position.',
  category: 'input',
  input: {},
  output: {
    position: Vec3,
    uv: { type: Vec2, label: 'UV' },
    index: Float,
    fraction: { type: Float, label: 'Index 0 to 1' },
    segment: Float,
  },
  exec: (_, ctx) => {
    const led = ctx.declare('vec4', 'ledLayout(ledIndex)')
    return {
      position: swizzle(led, 'xyz'),
      uv: swizzle(led, 'xy'),
      index: { expr: 'ledIndex', type: 'float' },
      fraction: { expr: '((ledIndex + 0.5) / iLedCount)', type: 'float' },
      segment: swizzle(led, 'w'),
    }
  },
})
