import { Color, defineNode, Float } from '@/lib/graph/authoring'
import { noiseChunk } from '@/lib/graph/nodes/glsl/noise'
import { textureVector } from '@/lib/graph/nodes/shared/sockets'

export const noiseTextureNode = defineNode('noiseTexture', {
  title: 'Noise Texture',
  description: 'Fractal value noise. Detail adds octaves, Roughness sets how much each one contributes, Distortion warps the lookup.',
  category: 'noise',
  includes: [noiseChunk],
  input: {
    vector: textureVector,
    scale: { type: Float, default: 5, props: { step: 0.1, decimals: 2 } },
    detail: { type: Float, default: 2, props: { min: 0, max: 15, step: 0.1, decimals: 2 } },
    roughness: { type: Float, default: 0.5, props: { min: 0, max: 1 } },
    distortion: { type: Float, default: 0, props: { step: 0.1, decimals: 2 } },
  },
  output: { fac: Float, color: Color },
  pixel: ({ vector, scale, detail, roughness, distortion }, ctx) => {
    const p = ctx.declare('vec3', `${vector.expr} * ${scale.expr}`, 'p')
    // Blender warps the point by noise sampled at an offset, then decorrelates the color channels the same way
    const warped = ctx.declare('vec3', `${p.expr} + ${distortion.expr} * (vec3(noise3(${p.expr} + 13.5), noise3(${p.expr}), noise3(${p.expr} - 13.5)) * 2.0 - 1.0)`, 'warped')
    const fbm = (point: string) => `noise_fbm(${point}, ${detail.expr}, ${roughness.expr}, 2.0, true)`
    const fac = ctx.declare('float', fbm(warped.expr), 'fac')
    const color = ctx.declare('vec3', `vec3(${fac.expr}, ${fbm(`${warped.expr}.yxz + 27.1`)}, ${fbm(`${warped.expr}.zyx - 41.3`)})`, 'color')
    return { fac, color }
  },
})
