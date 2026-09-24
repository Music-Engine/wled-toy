import { Color, defineNode, Enum, enumIndex, Float } from '@/lib/graph/authoring'
import { textureVector } from '@/lib/graph/nodes/shared/sockets'
import { gradientTextureChunk } from './chunks/gradient-texture-chunk'

const TYPES = [
  { value: 'linear', label: 'Linear' }, { value: 'quadratic', label: 'Quadratic' }, { value: 'easing', label: 'Easing' }, { value: 'diagonal', label: 'Diagonal' },
  { value: 'radial', label: 'Radial' }, { value: 'spherical', label: 'Spherical' }, { value: 'quadraticSphere', label: 'Quadratic Sphere' },
] as const

export const gradientTextureNode = defineNode('gradientTexture', {
  title: 'Gradient Texture',
  description: 'A 0 to 1 ramp across space: along x, around the origin, or falling off from it.',
  category: 'noise',
  includes: [gradientTextureChunk],
  input: {
    type: { type: Enum(TYPES), label: '', linkable: false, props: { label: 'Gradient' } },
    vector: textureVector,
  },
  output: { fac: Float, color: Color },
  pixel: ({ type, vector }, ctx) => ctx.call('gradient_texture', [vector.expr, enumIndex(TYPES, type)], { fac: 'float', color: 'vec3' }),
})
