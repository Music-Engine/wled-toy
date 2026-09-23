import { Bool, Color, defineNode, Enum, Float } from '@/lib/graph/authoring'
import { emitRamp, type ColorRamp } from './color-ramp'

const hex = (color: string) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
const evenly = (...colors: string[]): ColorRamp['stops'] => colors.map((color, i) => ({ position: i / (colors.length - 1), color: hex(color) }))

// looping palettes start and end on the same color, so Repeat wraps without a seam
const PALETTES = [
  { value: 'rainbow', label: 'Rainbow', stops: evenly('#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000') },
  { value: 'heat', label: 'Heat', stops: evenly('#000000', '#8b0000', '#ff4500', '#ffd700', '#ffffff') },
  { value: 'lava', label: 'Lava', stops: evenly('#000000', '#4a0000', '#c21500', '#ff6a00', '#ffc400', '#4a0000', '#000000') },
  { value: 'ocean', label: 'Ocean', stops: evenly('#000428', '#004e92', '#00a8c5', '#9be7e1', '#004e92', '#000428') },
  { value: 'forest', label: 'Forest', stops: evenly('#0b2b12', '#1e5d2b', '#5a9c2e', '#c5d86d', '#1e5d2b', '#0b2b12') },
  { value: 'party', label: 'Party', stops: evenly('#5500ab', '#ab0055', '#ff3300', '#ffaa00', '#00ab55', '#0055ab', '#5500ab') },
  { value: 'sunset', label: 'Sunset', stops: evenly('#0b0033', '#5a1a6e', '#c4325a', '#ff8a3d', '#ffd98a') },
  { value: 'ice', label: 'Ice', stops: evenly('#000814', '#0a3d78', '#4aa3df', '#c9f0ff', '#ffffff') },
] as const

export const paletteNode = defineNode('gradientPalette', {
  title: 'Palette',
  description: 'A named gradient. Position picks a color along it; with Repeat on, positions past 1 wrap around, so adding Time scrolls it forever.',
  category: 'color',
  input: {
    palette: { type: Enum(PALETTES), label: '', linkable: false, props: { label: 'Palette' } },
    repeat: { type: Bool, default: true, linkable: false },
    position: { type: Float, default: { expr: 'uv.x', label: 'uv.x' } },
  },
  output: { color: Color },
  pixel: ({ palette, repeat, position }, ctx) => ({
    color: emitRamp(ctx, { interpolation: 'linear', stops: [...PALETTES.find((p) => p.value === palette)!.stops] }, repeat ? `fract(${position.expr})` : position.expr),
  }),
})
