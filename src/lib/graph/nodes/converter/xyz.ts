import { defineNode, Float, swizzle, Vec3 } from '@/lib/graph/authoring'
import { textureVector } from '@/lib/graph/nodes/shared/sockets'

export const combineXyzNode = defineNode('combineXYZ', {
  title: 'Combine XYZ',
  description: 'A vector from three numbers. Put Time into Z to move a texture through its third dimension.',
  category: 'converter',
  input: {
    x: { type: Float, label: 'X', default: 0 },
    y: { type: Float, label: 'Y', default: 0 },
    z: { type: Float, label: 'Z', default: 0 },
  },
  output: { vector: Vec3 },
  body: ({ x, y, z }, ctx) => ({ vector: ctx.declare('vec3', `vec3(${x.expr}, ${y.expr}, ${z.expr})`) }),
})

export const separateXyzNode = defineNode('separateXYZ', {
  title: 'Separate XYZ',
  description: 'The three components of a vector.',
  category: 'converter',
  input: { vector: textureVector },
  output: { x: { type: Float, label: 'X' }, y: { type: Float, label: 'Y' }, z: { type: Float, label: 'Z' } },
  body: ({ vector }, ctx) => {
    const components = ctx.declare('vec3', vector.expr)
    return { x: swizzle(components, 'x'), y: swizzle(components, 'y'), z: swizzle(components, 'z') }
  },
})
