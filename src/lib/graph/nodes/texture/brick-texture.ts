import { defineNode } from '@/lib/graph/define/define'
import { brickTextureChunk } from '@/lib/graph/compile/glsl/brick-texture'
import { Color, Float, Int } from '@/lib/graph/define/socket-types'
import { textureVector } from './vector'

const amount = { min: 0, step: 0.01, decimals: 2 }
const frequency = { min: 1, step: 1, decimals: 0 }

export const brickTextureNode = defineNode('brickTexture', {
  title: 'Brick Texture',
  description: 'Rows of bricks with mortar between them. Every Offset Frequency rows shift sideways, every Squash Frequency rows change width.',
  category: 'noise',
  includes: [brickTextureChunk],
  input: {
    offset: { type: Float, default: 0.5, connectable: false, props: { ...amount, max: 1 } },
    offsetFrequency: { type: Int, default: 2, connectable: false, props: frequency },
    squash: { type: Float, default: 1, connectable: false, props: amount },
    squashFrequency: { type: Int, default: 1, connectable: false, props: frequency },
    vector: textureVector,
    color1: { type: Color, label: 'Color 1', default: [1, 1, 1] },
    color2: { type: Color, label: 'Color 2', default: [0, 0, 0] },
    mortar: { type: Color, default: [0.67, 0.67, 0.67] },
    scale: { type: Float, default: 5, props: amount },
    mortarSize: { type: Float, default: 0.02, props: amount },
    mortarSmooth: { type: Float, default: 0, props: { ...amount, max: 1 } },
    bias: { type: Float, default: 0, props: { min: -1, max: 1, step: 0.01, decimals: 2 } },
    brickWidth: { type: Float, default: 0.5, props: amount },
    rowHeight: { type: Float, default: 0.25, props: amount },
  },
  output: { fac: Float, color: Color },
  exec: (input, ctx) => ctx.call('brick_texture', [
    Float.literal(input.offset).expr, String(input.offsetFrequency), Float.literal(input.squash).expr, String(input.squashFrequency),
    input.scale.expr, input.mortarSize.expr, input.mortarSmooth.expr, input.bias.expr, input.brickWidth.expr, input.rowHeight.expr,
    input.vector.expr, input.color1.expr, input.color2.expr, input.mortar.expr,
  ], { fac: 'float', color: 'vec3' }),
})
