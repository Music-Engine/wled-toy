import { defineNode } from '@/lib/graph/define/define';
import { Float, Vec3 } from '@/lib/graph/define/types';
import { swizzle } from '@/lib/graph/define/value';

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
  exec: ({ x, y, z }, ctx) => ({ vector: ctx.declare('vec3', `vec3(${x.expr}, ${y.expr}, ${z.expr})`) }),
  run: ({ x, y, z }) => ({ vector: [x, y, z] }),
});

export const separateXyzNode = defineNode('separateXYZ', {
  title: 'Separate XYZ',
  description: 'The three components of a vector.',
  category: 'converter',
  input: { vector: { type: Vec3, default: { expr: 'vec3(uv, 0.0)', label: 'uv' } } },
  output: { x: { type: Float, label: 'X' }, y: { type: Float, label: 'Y' }, z: { type: Float, label: 'Z' } },
  exec: ({ vector }, ctx) => {
    const v = ctx.declare('vec3', vector.expr);
    return { x: swizzle(v, 'x'), y: swizzle(v, 'y'), z: swizzle(v, 'z') };
  },
  run: ({ vector }) => ({ x: vector[0], y: vector[1], z: vector[2] }),
});
