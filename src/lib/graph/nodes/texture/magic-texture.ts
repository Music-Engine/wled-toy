import { defineNode } from '@/lib/graph/define/define'
import { magicTextureChunk } from '@/lib/graph/compile/glsl/magic-texture'
import { Color, Float, Int } from '@/lib/graph/define/socket-types'
import { textureVector } from './vector'

export const magicTextureNode = defineNode('magicTexture', {
  title: 'Magic Texture',
  description: 'Psychedelic interference of sines. Cheap, colorful, and it animates well when the vector moves.',
  category: 'noise',
  includes: [magicTextureChunk],
  input: {
    depth: { type: Int, default: 2, connectable: false, props: { min: 0, max: 10, step: 1, decimals: 0 } },
    vector: textureVector,
    scale: { type: Float, default: 5, props: { step: 0.1, decimals: 2 } },
    distortion: { type: Float, default: 1, props: { step: 0.1, decimals: 2 } },
  },
  output: { fac: Float, color: Color },
  exec: ({ depth, vector, scale, distortion }, ctx) =>
    ctx.call('magic_texture', [String(depth), distortion.expr, scale.expr, vector.expr], { fac: 'float', color: 'vec3' }),
})
