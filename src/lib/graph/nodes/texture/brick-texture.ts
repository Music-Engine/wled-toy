import { Color, defineNode, Float, fmt, Int } from '@/lib/graph/authoring'
import { textureVector } from '@/lib/graph/nodes/shared/sockets'
import { brickTextureChunk } from './brick-texture-chunk'

const amount = { min: 0, step: 0.01, decimals: 2 }
const frequency = { min: 1, step: 1, decimals: 0 }

export const brickTextureNode = defineNode('brickTexture', {
  title: 'Brick Texture',
  description: 'Rows of bricks with mortar between them. Every Offset Frequency rows shift sideways, every Squash Frequency rows change width.',
  category: 'noise',
  includes: [brickTextureChunk],
  input: {
    offset: { type: Float, default: 0.5, linkable: false, props: { ...amount, max: 1 } },
    offsetFrequency: { type: Int, default: 2, linkable: false, props: frequency },
    squash: { type: Float, default: 1, linkable: false, props: amount },
    squashFrequency: { type: Int, default: 1, linkable: false, props: frequency },
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
  pixel: (input, ctx) => ctx.call('brick_texture', [
    fmt(input.offset), String(input.offsetFrequency), fmt(input.squash), String(input.squashFrequency),
    input.scale.expr, input.mortarSize.expr, input.mortarSmooth.expr, input.bias.expr, input.brickWidth.expr, input.rowHeight.expr,
    input.vector.expr, input.color1.expr, input.color2.expr, input.mortar.expr,
  ], { fac: 'float', color: 'vec3' }),
})
