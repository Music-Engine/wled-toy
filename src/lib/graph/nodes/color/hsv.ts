import { defineNode } from '@/lib/graph/define/define'
import { hsvToRgbChunk, rgbToHsvChunk } from '@/lib/graph/compile/glsl/color'
import { Color, Float, Vec3 } from '@/lib/graph/define/types'

export const hsvToRgbNode = defineNode('hsv2rgb', {
  title: 'HSV to RGB',
  description: 'Convert a hue, saturation, value vector (all 0 to 1) to a color.',
  category: 'color',
  includes: [hsvToRgbChunk],
  input: { hsv: { type: Vec3, label: 'HSV', default: { expr: 'vec3(uv.x, 1.0, 1.0)', label: 'hue along strip' } } },
  output: { color: Color },
  exec: ({ hsv }, ctx) => ({ color: ctx.declare('vec3', `hsv_to_rgb(${hsv.expr})`) }),
})

export const rgbToHsvNode = defineNode('rgb2hsv', {
  title: 'RGB to HSV',
  description: 'Convert a color to a hue, saturation, value vector.',
  category: 'color',
  includes: [rgbToHsvChunk],
  input: { color: { type: Color, default: [1, 0.45, 0.1] } },
  output: { hsv: { type: Vec3, label: 'HSV' } },
  exec: ({ color }, ctx) => ({ hsv: ctx.declare('vec3', `rgb_to_hsv(${color.expr})`) }),
})

export const hueSaturationNode = defineNode('hueSaturation', {
  title: 'Hue/Saturation/Value',
  description: 'Turns the hue (a shift of 1 is a full circle), scales saturation and value, and fades the change in by Factor.',
  category: 'color',
  includes: [rgbToHsvChunk, hsvToRgbChunk],
  input: {
    hue: { type: Float, default: 0, props: { step: 0.01, decimals: 3 } },
    saturation: { type: Float, default: 1, props: { min: 0, step: 0.05, decimals: 2 } },
    value: { type: Float, default: 1, props: { min: 0, step: 0.05, decimals: 2 } },
    factor: { type: Float, default: 1, props: { min: 0, max: 1, decimals: 2 } },
    color: { type: Color, default: [1, 0.45, 0.1] },
  },
  output: { color: Color },
  exec: ({ hue, saturation, value, factor, color }, ctx) => {
    const hsv = ctx.declare('vec3', `rgb_to_hsv(${color.expr})`, 'hsv').expr
    const adjusted = `hsv_to_rgb(vec3(fract(${hsv}.x + ${hue.expr}), clamp(${hsv}.y * ${saturation.expr}, 0.0, 1.0), ${hsv}.z * ${value.expr}))`
    return { color: ctx.declare('vec3', `mix(${color.expr}, max(${adjusted}, vec3(0.0)), ${factor.expr})`) }
  },
})
