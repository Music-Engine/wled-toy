import { defineNode } from '@/lib/graph/define/define'
import { checkerTextureChunk } from '@/lib/graph/compile/glsl/checker-texture'
import { Color, Float } from '@/lib/graph/define/socket-types'
import { textureVector } from './vector'

export const checkerTextureNode = defineNode('checkerTexture', {
  title: 'Checker Texture',
  description: 'Alternating cells of two colors. On a strip this is a run of Scale segments.',
  category: 'noise',
  includes: [checkerTextureChunk],
  input: {
    vector: textureVector,
    color1: { type: Color, label: 'Color 1', default: [1, 1, 1] },
    color2: { type: Color, label: 'Color 2', default: [0, 0, 0] },
    scale: { type: Float, default: 5, props: { min: 0, step: 0.1, decimals: 2 } },
  },
  output: { fac: Float, color: Color },
  exec: ({ vector, color1, color2, scale }, ctx) =>
    ctx.call('checker_texture', [scale.expr, vector.expr, color1.expr, color2.expr], { fac: 'float', color: 'vec3' }),
})
