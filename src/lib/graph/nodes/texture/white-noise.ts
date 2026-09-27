import { Color, defineNode, Float } from '@/lib/graph/authoring'
import { commonChunk } from '@/lib/graph/nodes/glsl/common'
import { textureVector } from '@/lib/graph/nodes/shared/sockets'

export const whiteNoiseNode = defineNode('whiteNoise', {
  title: 'White Noise Texture',
  description: 'A random value per point, with no smoothness at all: static, sparkle, per-LED randomness when fed the LED index.',
  category: 'noise',
  includes: [commonChunk],
  input: { vector: textureVector },
  output: { fac: Float, color: Color },
  pixel: ({ vector }, ctx) => {
    const fac = ctx.declare('float', `node_hash(${vector.expr}.xy + ${vector.expr}.z)`, 'fac')
    const color = ctx.declare('vec3', `vec3(${fac.expr}, node_hash(${vector.expr}.yz + 17.3 + ${vector.expr}.x), node_hash(${vector.expr}.zx + 41.7 + ${vector.expr}.y))`)
    return { fac, color }
  },
})
