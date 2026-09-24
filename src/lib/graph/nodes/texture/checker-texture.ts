import { Color, defineNode, Float } from '@/lib/graph/authoring'
import { textureVector } from '@/lib/graph/nodes/shared/sockets'
import { checkerTextureChunk } from './checker-texture-chunk'

export const checkerTextureNode = defineNode('checkerTexture', {
  title: 'Checker Texture',
  description: 'Alternating cells of two colors. On a strip this is a row of Scale segments.',
  category: 'noise',
  includes: [checkerTextureChunk],
  input: {
    vector: textureVector,
    color1: { type: Color, label: 'Color 1', default: [1, 1, 1] },
    color2: { type: Color, label: 'Color 2', default: [0, 0, 0] },
    scale: { type: Float, default: 5, props: { min: 0, step: 0.1, decimals: 2 } },
  },
  output: { fac: Float, color: Color },
  pixel: ({ vector, color1, color2, scale }, ctx) =>
    ctx.call('checker_texture', [scale.expr, vector.expr, color1.expr, color2.expr], { fac: 'float', color: 'vec3' }),
})
