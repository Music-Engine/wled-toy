import { Color, defineNode, Float, Int } from '@/lib/graph/authoring'
import { textureVector } from '@/lib/graph/nodes/shared/sockets'
import { magicTextureChunk } from './magic-texture-chunk'

export const magicTextureNode = defineNode('magicTexture', {
  title: 'Magic Texture',
  description: 'Psychedelic interference of sines. Cheap, colorful, and it animates well when the vector moves.',
  category: 'noise',
  includes: [magicTextureChunk],
  input: {
    depth: { type: Int, default: 2, linkable: false, props: { min: 0, max: 10, step: 1, decimals: 0 } },
    vector: textureVector,
    scale: { type: Float, default: 5, props: { step: 0.1, decimals: 2 } },
    distortion: { type: Float, default: 1, props: { step: 0.1, decimals: 2 } },
  },
  output: { fac: Float, color: Color },
  pixel: ({ depth, vector, scale, distortion }, ctx) =>
    ctx.call('magic_texture', [String(depth), distortion.expr, scale.expr, vector.expr], { fac: 'float', color: 'vec3' }),
})
