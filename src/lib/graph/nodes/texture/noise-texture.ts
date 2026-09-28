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
  body: ({ vector, scale, detail, roughness, distortion }, ctx) => {
    const point = ctx.declare('vec3', `${vector.expr} * ${scale.expr}`, 'p')
    // As Blender: warp by noise sampled at an offset, decorrelate color channels the same way
    const warped = ctx.declare('vec3', `${point.expr} + ${distortion.expr} * (vec3(noise3(${point.expr} + 13.5), noise3(${point.expr}), noise3(${point.expr} - 13.5)) * 2.0 - 1.0)`, 'warped')
    const sampleFbm = (at: string) => `noise_fbm(${at}, ${detail.expr}, ${roughness.expr}, 2.0, true)`
    const fac = ctx.declare('float', sampleFbm(warped.expr), 'fac')
    const color = ctx.declare('vec3', `vec3(${fac.expr}, ${sampleFbm(`${warped.expr}.yxz + 27.1`)}, ${sampleFbm(`${warped.expr}.zyx - 41.3`)})`, 'color')
    return { fac, color }
  },
})
