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

const isStop = (raw: unknown): raw is RampStop => {
  const stop = raw as Partial<RampStop> | null
  return !!stop && Number.isFinite(stop.position) && Array.isArray(stop.color) && stop.color.length >= 3 && stop.color.every(Number.isFinite)
}

const Ramp: DataType<ColorRamp> = {
  id: 'ramp',
  label: 'Color ramp',
  kind: 'param',
  castableFrom: [],
  check: (raw): raw is ColorRamp => {
    const ramp = raw as Partial<ColorRamp> | null
    return !!ramp && RAMP_INTERPOLATIONS.some((i) => i.value === ramp.interpolation) && Array.isArray(ramp.stops) && ramp.stops.every(isStop)
  },
  initial: defaultRamp,
}

export const colorRampNode = defineNode('colorRamp', {
  title: 'Color Ramp',
  description: 'Map a 0 to 1 value onto a gradient of color stops.',
  category: 'color',
  signature: 'vec3 colorRamp(float fac)',
  input: {
    ramp: { type: Ramp, label: '', linkable: false },
    fac: { type: Float, label: 'Factor', default: { expr: 'uv.x', label: 'uv.x' } },
  },
  output: { color: Color },
  pixel: ({ ramp, fac }, ctx) => ({ color: emitRamp(ctx, ramp, fac.expr) }),
})

/** Emits the GLSL that evaluates `ramp` at the float expression `fac`. Shared with the Palette node. */
export function emitRamp(ctx: NodeContext, ramp: ColorRamp, fac: string): Value {
  const stops = sorted(ramp)
  if (stops.length === 0) {
    ctx.issue('Color ramp needs at least one stop')
    return { expr: 'vec3(0.0)', type: 'vec3' }
  }
  const f = ctx.declare('float', fac, 'fac').expr
  if (ramp.interpolation === 'spline' && stops.length > 1) return emitSpline(ctx, stops, f)
  return emitSegments(ctx, ramp, stops, f)
}

function emitSpline(ctx: NodeContext, stops: RampStop[], f: string): Value {
  const controls = splineControls(stops.map((s) => s.color))
  const points = ctx.variable('points')
  ctx.emit(`vec3 ${points}[${controls.length}] = vec3[${controls.length}](${controls.map(colorLiteral).join(', ')});`)
  const x = ctx.declare('float', `clamp(${f}, 0.0, 1.0) * ${fmt(stops.length - 1)}`, 'x').expr
  const i = ctx.declare('int', `min(int(${x}), ${stops.length - 2})`, 'i').expr
  const t = ctx.declare('float', `${x} - float(${i})`, 't').expr
  const t2 = `${t} * ${t}`
  const t3 = `${t2} * ${t}`
  return ctx.declare('vec3', `(pow(1.0 - ${t}, 3.0) * ${points}[${i}] + (3.0 * ${t3} - 6.0 * ${t2} + 4.0) * ${points}[${i} + 1] `
    + `+ (-3.0 * ${t3} + 3.0 * ${t2} + 3.0 * ${t} + 1.0) * ${points}[${i} + 2] + ${t3} * ${points}[${i} + 3]) / 6.0`)
}

function emitSegments(ctx: NodeContext, ramp: ColorRamp, stops: RampStop[], f: string): Value {
  const color = ctx.declare('vec3', colorLiteral(stops[0].color))
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]
    const b = stops[i]
    const span = b.position - a.position
    const blend = segmentBlend(ramp.interpolation, span)
    const weight = blend === 'constant' ? `step(${fmt(b.position)}, ${f})`
      : blend === 'ease' ? `smoothstep(${fmt(a.position)}, ${fmt(b.position)}, ${f})`
        : `clamp((${f} - ${fmt(a.position)}) / ${fmt(span)}, 0.0, 1.0)`
    ctx.emit(`${color.expr} = mix(${color.expr}, ${colorLiteral(b.color)}, ${weight});`)
  }
  return color
}

/** The color a ramp yields at `fac`. The editor previews with this, and the GLSL the node emits computes the same thing. */
export function sampleRamp(ramp: ColorRamp, fac: number): number[] {
  const stops = sorted(ramp)
  if (stops.length === 0) return [0, 0, 0]
  if (ramp.interpolation === 'spline' && stops.length > 1) return sampleSpline(stops, fac)
  return sampleSegments(ramp, stops, fac)
}

function sampleSpline(stops: RampStop[], fac: number): number[] {
  const controls = splineControls(stops.map((stop) => stop.color.slice(0, 3)))
  const x = Math.min(1, Math.max(0, fac)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  const t = x - i
  const weights = [(1 - t) ** 3, 3 * t ** 3 - 6 * t ** 2 + 4, -3 * t ** 3 + 3 * t ** 2 + 3 * t + 1, t ** 3]
  return [0, 1, 2].map((k) => weights.reduce((sum, w, j) => sum + w * controls[i + j][k], 0) / 6)
}

function sampleSegments(ramp: ColorRamp, stops: RampStop[], fac: number): number[] {
  let color = stops[0].color.slice(0, 3)
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]
    const b = stops[i]
    const span = b.position - a.position
    const linear = Math.min(1, Math.max(0, (fac - a.position) / span))
    const blend = segmentBlend(ramp.interpolation, span)
    const weight = blend === 'constant' ? Number(fac >= b.position) : blend === 'ease' ? linear * linear * (3 - 2 * linear) : linear
    color = color.map((c, k) => c + (b.color[k] - c) * weight)
  }
  return color
}

// smoothstep is undefined when both edges are equal, so coincident stops snap instead
function segmentBlend(interpolation: RampInterpolation, span: number): 'constant' | 'ease' | 'linear' {
  if (interpolation === 'constant' || span < 1e-4) return 'constant'
  return interpolation === 'ease' ? 'ease' : 'linear'
}

// Uniform cubic B-spline through evenly spaced colors: smooth, and like Blender's it only approaches the stops.
// The first and last colors are mirrored so the curve starts and ends on the outer stops.
function splineControls(colors: number[][]): number[][] {
  if (colors.length < 2) return colors
  const mirror = (a: number[], b: number[]) => a.map((c, k) => 2 * c - b[k])
  return [mirror(colors[0], colors[1]), ...colors, mirror(colors[colors.length - 1], colors[colors.length - 2])]
}

const sorted = (ramp: ColorRamp) => [...ramp.stops].sort((a, b) => a.position - b.position)

const colorLiteral = (color: number[]) => vectorLiteral(color.slice(0, 3)).expr
