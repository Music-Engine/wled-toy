import { defineNode } from '@/lib/graph/define/define'
import { hslToRgbChunk, hsvToRgbChunk, rgbToHslChunk, rgbToHsvChunk } from '@/lib/graph/compile/glsl/color'
import { Color, Enum, Float } from '@/lib/graph/define/types'
import { swizzle } from '@/lib/graph/define/value'

const MODES = [{ value: 'rgb', label: 'RGB' }, { value: 'hsv', label: 'HSV' }, { value: 'hsl', label: 'HSL' }] as const
type Mode = (typeof MODES)[number]['value']
const CHANNELS: Record<Mode, [string, string, string]> = { rgb: ['Red', 'Green', 'Blue'], hsv: ['Hue', 'Saturation', 'Value'], hsl: ['Hue', 'Saturation', 'Lightness'] }

/** Blender's Separate Color: the mode names the channels. */
export const separateColorNode = defineNode('separateColor', ({ mode = 'rgb' }: { mode?: Mode }) => {
  const [a, b, c] = CHANNELS[mode] ?? CHANNELS.rgb
  return {
    title: 'Separate Color',
    description: 'A color as three numbers: red, green, blue, or hue, saturation and value or lightness.',
    category: 'converter',
    includes: mode === 'hsv' ? [rgbToHsvChunk] : mode === 'hsl' ? [rgbToHslChunk] : [],
    input: { mode: { type: Enum(MODES), label: '', default: 'rgb', connectable: false, props: { label: 'Mode' } }, color: { type: Color, default: [1, 0.45, 0.1] } },
    output: { a: { type: Float, label: a }, b: { type: Float, label: b }, c: { type: Float, label: c } },
    exec: ({ color }, ctx) => {
      const v = ctx.declare('vec3', mode === 'hsv' ? `rgb_to_hsv(${color.expr})` : mode === 'hsl' ? `rgb_to_hsl(${color.expr})` : color.expr)
      return { a: swizzle(v, 'x'), b: swizzle(v, 'y'), c: swizzle(v, 'z') }
    },
  }
})

export const combineColorNode = defineNode('combineColor', ({ mode = 'rgb' }: { mode?: Mode }) => {
  const [a, b, c] = CHANNELS[mode] ?? CHANNELS.rgb
  const channel = (label: string, fallback: number) => ({ type: Float, label, default: fallback, props: { min: 0, max: 1 } })
  return {
    title: 'Combine Color',
    description: 'A color from three numbers, as red, green, blue, or hue, saturation and value or lightness.',
    category: 'converter',
    includes: mode === 'hsv' ? [hsvToRgbChunk] : mode === 'hsl' ? [hslToRgbChunk] : [],
    input: { mode: { type: Enum(MODES), label: '', default: 'rgb', connectable: false, props: { label: 'Mode' } }, a: channel(a, mode === 'rgb' ? 1 : 0), b: channel(b, mode === 'rgb' ? 0.45 : 1), c: channel(c, mode === 'rgb' ? 0.1 : mode === 'hsl' ? 0.5 : 1) },
    output: { color: Color },
    exec: (input, ctx) => {
      const v = `vec3(${input.a.expr}, ${input.b.expr}, ${input.c.expr})`
      return { color: ctx.declare('vec3', mode === 'hsv' ? `hsv_to_rgb(${v})` : mode === 'hsl' ? `hsl_to_rgb(${v})` : v) }
    },
  }
})
