import { defineNode } from '@/lib/graph/define/define'
import { Float, Vec3 } from '@/lib/graph/define/socket-types'
import { textureVector } from '@/lib/graph/nodes/texture/vector'

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
  exec: ({ vector, location, rotation, scale, pivot }, ctx) => {
    const p = ctx.declare('vec3', `(${vector.expr} - ${pivot.expr}) * ${scale.expr}`, 'p').expr
    const a = ctx.declare('float', `${rotation.expr} * 6.2831853`, 'a').expr
    // turning the lookup by -a turns the picture by +a
    const turned = `vec3(${p}.x * cos(${a}) + ${p}.y * sin(${a}), ${p}.y * cos(${a}) - ${p}.x * sin(${a}), ${p}.z)`
    return { vector: ctx.declare('vec3', `${turned} + ${pivot.expr} + ${location.expr}`) }
  },
})
