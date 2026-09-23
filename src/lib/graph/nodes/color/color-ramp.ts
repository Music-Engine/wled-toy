import { Color, defineNode, Float, fmt, vectorLiteral, type DataType, type EnumOption, type NodeContext, type Value } from '@/lib/graph/authoring'

export type RampInterpolation = 'linear' | 'ease' | 'constant' | 'spline'

export const RAMP_INTERPOLATIONS: EnumOption<RampInterpolation>[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease', label: 'Ease' },
  { value: 'constant', label: 'Constant' },
  { value: 'spline', label: 'B-Spline' },
]

export interface RampStop {
  position: number
  color: number[]
}

export interface ColorRamp {
  interpolation: RampInterpolation
  stops: RampStop[]
}

export const defaultRamp = (): ColorRamp => ({
  interpolation: 'linear',
  stops: [
    { position: 0, color: [0, 0, 0] },
    { position: 1, color: [1, 1, 1] },
  ],
})

const sorted = (ramp: ColorRamp) => [...ramp.stops].sort((a, b) => a.position - b.position)

// Uniform cubic B-spline through evenly spaced control colors: smooth, and like Blender's it only approaches the stops.
// The first and last control points are mirrored so the curve starts and ends on the outer stops.
function splineControls(colors: number[][]): number[][] {
  if (colors.length < 2) return colors
  const mirror = (a: number[], b: number[]) => a.map((c, k) => 2 * c - b[k])
  return [mirror(colors[0], colors[1]), ...colors, mirror(colors[colors.length - 1], colors[colors.length - 2])]
}

/** The color a ramp yields at `fac`. The editor previews with this, and the GLSL the node emits computes the same thing. */
export function sampleRamp(ramp: ColorRamp, fac: number): number[] {
  const stops = sorted(ramp)
  if (stops.length === 0) return [0, 0, 0]
  const rgb = (stop: RampStop) => stop.color.slice(0, 3)
  if (ramp.interpolation === 'spline' && stops.length > 1) {
    const controls = splineControls(stops.map(rgb))
    const x = Math.min(1, Math.max(0, fac)) * (stops.length - 1)
    const i = Math.min(stops.length - 2, Math.floor(x))
    const t = x - i
    const weights = [(1 - t) ** 3, 3 * t ** 3 - 6 * t ** 2 + 4, -3 * t ** 3 + 3 * t ** 2 + 3 * t + 1, t ** 3]
    return [0, 1, 2].map((k) => weights.reduce((sum, w, j) => sum + w * controls[i + j][k], 0) / 6)
  }
  let color = rgb(stops[0])
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]
    const b = stops[i]
    const span = b.position - a.position
    const linear = Math.min(1, Math.max(0, (fac - a.position) / span))
    const weight = ramp.interpolation === 'constant' || span < 1e-4 ? Number(fac >= b.position)
      : ramp.interpolation === 'ease' ? linear * linear * (3 - 2 * linear)
        : linear
    color = color.map((c, k) => c + (b.color[k] - c) * weight)
  }
  return color
}

const isStop = (raw: unknown): raw is RampStop => {
  const stop = raw as Partial<RampStop> | null
  return !!stop && Number.isFinite(stop.position) && Array.isArray(stop.color) && stop.color.length >= 3 && stop.color.every(Number.isFinite)
}

export const Ramp: DataType<ColorRamp> = {
  id: 'ramp',
  label: 'Color ramp',
  check: (raw): raw is ColorRamp => {
    const ramp = raw as Partial<ColorRamp> | null
    return !!ramp && RAMP_INTERPOLATIONS.some((i) => i.value === ramp.interpolation) && Array.isArray(ramp.stops) && ramp.stops.every(isStop)
  },
  initial: defaultRamp,
}

/** Emits the GLSL that evaluates `ramp` at the float expression `fac`. Shared with the Palette node. */
export function emitRamp(ctx: NodeContext, ramp: ColorRamp, fac: string): Value {
  const stops = sorted(ramp)
  if (stops.length === 0) {
    ctx.issue('Color ramp needs at least one stop')
    return { expr: 'vec3(0.0)', type: 'vec3' }
  }
  const f = ctx.declare('float', fac, 'fac').expr
  const literal = (color: number[]) => vectorLiteral(color.slice(0, 3)).expr

  if (ramp.interpolation === 'spline' && stops.length > 1) {
    const controls = splineControls(stops.map((s) => s.color))
    const points = ctx.variable('points')
    ctx.emit(`vec3 ${points}[${controls.length}] = vec3[${controls.length}](${controls.map(literal).join(', ')});`)
    const x = ctx.declare('float', `clamp(${f}, 0.0, 1.0) * ${fmt(stops.length - 1)}`, 'x').expr
    const i = ctx.declare('int', `min(int(${x}), ${stops.length - 2})`, 'i').expr
    const t = ctx.declare('float', `${x} - float(${i})`, 't').expr
    const t2 = `${t} * ${t}`
    const t3 = `${t2} * ${t}`
    return ctx.declare('vec3', `(pow(1.0 - ${t}, 3.0) * ${points}[${i}] + (3.0 * ${t3} - 6.0 * ${t2} + 4.0) * ${points}[${i} + 1] `
      + `+ (-3.0 * ${t3} + 3.0 * ${t2} + 3.0 * ${t} + 1.0) * ${points}[${i} + 2] + ${t3} * ${points}[${i} + 3]) / 6.0`)
  }

  const color = ctx.declare('vec3', literal(stops[0].color))
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]
    const b = stops[i]
    const span = b.position - a.position
    // smoothstep is undefined when both edges are equal, so coincident stops snap instead
    const weight = ramp.interpolation === 'constant' || span < 1e-4
      ? `step(${fmt(b.position)}, ${f})`
      : ramp.interpolation === 'ease'
        ? `smoothstep(${fmt(a.position)}, ${fmt(b.position)}, ${f})`
        : `clamp((${f} - ${fmt(a.position)}) / ${fmt(span)}, 0.0, 1.0)`
    ctx.emit(`${color.expr} = mix(${color.expr}, ${literal(b.color)}, ${weight});`)
  }
  return color
}

export const colorRampNode = defineNode('colorRamp', {
  title: 'Color Ramp',
  description: 'Map a 0 to 1 value onto a gradient of color stops.',
  category: 'color',
  signature: 'vec3 colorRamp(float fac)',
  input: {
    ramp: { type: Ramp, label: '', connectable: false },
    fac: { type: Float, label: 'Factor', default: { expr: 'uv.x', label: 'uv.x' } },
  },
  output: { color: Color },
  exec: ({ ramp, fac }, ctx) => ({ color: emitRamp(ctx, ramp, fac.expr) }),
})
