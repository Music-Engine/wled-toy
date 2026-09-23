import { defineNode } from '@/lib/graph/define/define'
import { gradientTextureChunk } from '@/lib/graph/compile/glsl/gradient-texture'
import { Color, Enum, Float, enumIndex } from '@/lib/graph/define/socket-types'
import { textureVector } from './vector'

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
    type: { type: Enum(TYPES), label: '', connectable: false, props: { label: 'Gradient' } },
    vector: textureVector,
  },
  output: { fac: Float, color: Color },
  exec: ({ type, vector }, ctx) => ctx.call('gradient_texture', [vector.expr, enumIndex(TYPES, type)], { fac: 'float', color: 'vec3' }),
})
