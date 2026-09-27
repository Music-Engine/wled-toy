import { defineNode, Float, Vec3 } from '@/lib/graph/authoring'
import { textureVector } from '@/lib/graph/nodes/shared/sockets'

export const mappingNode = defineNode('mapping', {
  title: 'Mapping',
  description: 'Moves, turns and scales a coordinate before a texture or image reads it: scale around the pivot, rotate around it (in turns), then add the location.',
  category: 'math',
  input: {
    vector: textureVector,
    location: { type: Vec3, default: [0, 0, 0] },
    rotation: { type: Float, label: 'Rotation (turns)', default: 0, props: { step: 0.01, decimals: 3 } },
    scale: { type: Vec3, default: [1, 1, 1] },
    pivot: { type: Vec3, default: [0.5, 0.5, 0] },
  },
  output: { vector: Vec3 },
  body: ({ vector, location, rotation, scale, pivot }, ctx) => {
    const point = ctx.declare('vec3', `(${vector.expr} - ${pivot.expr}) * ${scale.expr}`, 'p').expr
    const radians = ctx.declare('float', `${rotation.expr} * 6.2831853`, 'a').expr
    // Lookup turned by -angle turns the picture by +angle
    const turned = `vec3(${point}.x * cos(${radians}) + ${point}.y * sin(${radians}), ${point}.y * cos(${radians}) - ${point}.x * sin(${radians}), ${point}.z)`
    return { vector: ctx.declare('vec3', `${turned} + ${pivot.expr} + ${location.expr}`) }
  },
})
