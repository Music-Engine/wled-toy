import { defineNode, Enum, Float, swizzle, Vec2 } from '@/lib/graph/authoring'

const uvInput = { type: Vec2, label: 'UV', default: { expr: 'uv', label: 'uv' } } as const
const center = { type: Vec2, default: [0.5, 0.5] } as const

export const polarNode = defineNode('polar', {
  title: 'Polar',
  description: 'Position as an angle around a center (0 to 1, counter-clockwise from the right) and the distance from it (1 at the edge of the unit square).',
  category: 'math',
  input: { uv: uvInput, center },
  output: { polar: { type: Vec2, label: 'Polar UV' }, angle: Float, radius: Float },
  body: ({ uv, center }, ctx) => {
    const offset = ctx.declare('vec2', `${uv.expr} - ${center.expr}`, 'p').expr
    const polar = ctx.declare('vec2', `vec2(atan(${offset}.y, ${offset}.x) / 6.2831853 + 0.5, length(${offset}) * 2.0)`)
    return { polar, angle: swizzle(polar, 'x'), radius: swizzle(polar, 'y') }
  },
})

const MIRROR_AXES = [
  { value: 'x', label: 'X' },
  { value: 'y', label: 'Y' },
  { value: 'both', label: 'X and Y' },
] as const
const MIRROR_MODES = [
  { value: 'toCenter', label: '1 at Center' },
  { value: 'fromCenter', label: '0 at Center' },
] as const

export const mirrorNode = defineNode('mirror', {
  title: 'Mirror',
  description: 'Fold space at a center so both sides show the same thing. The result runs 0 to 1 between the center and the far edge.',
  category: 'math',
  input: {
    axis: { type: Enum(MIRROR_AXES), label: '', linkable: false, props: { label: 'Axis' } },
    mode: { type: Enum(MIRROR_MODES), label: '', linkable: false, props: { label: 'Mode' } },
    uv: uvInput,
    center,
  },
  output: { uv: { type: Vec2, label: 'UV' } },
  body: ({ axis, mode, uv, center }, ctx) => {
    const folded = `abs(${uv.expr} - ${center.expr}) / max(${center.expr}, 1.0 - ${center.expr})`
    const result = ctx.declare('vec2', mode === 'toCenter' ? `1.0 - ${folded}` : folded, 'folded').expr
    return { uv: ctx.declare('vec2', axis === 'both' ? result : axis === 'x' ? `vec2(${result}.x, ${uv.expr}.y)` : `vec2(${uv.expr}.x, ${result}.y)`) }
  },
})

export const tileNode = defineNode('tile', {
  title: 'Tile',
  description: 'Repeat space Count times. UV restarts in every tile; Cell says which tile a point is in.',
  category: 'math',
  input: { uv: uvInput, count: { type: Vec2, default: [4, 1] } },
  output: { uv: { type: Vec2, label: 'UV' }, cell: Vec2 },
  body: ({ uv, count }, ctx) => {
    const scaled = ctx.declare('vec2', `${uv.expr} * ${count.expr}`, 'scaled').expr
    return { uv: ctx.declare('vec2', `fract(${scaled})`), cell: ctx.declare('vec2', `floor(${scaled})`, 'cell') }
  },
})

export const rotateNode = defineNode('rotate', {
  title: 'Rotate',
  description: 'Turn space around a center. Angle is in turns: 0.25 is a quarter turn counter-clockwise.',
  category: 'math',
  input: { uv: uvInput, angle: { type: Float, default: 0, props: { step: 0.01, decimals: 3 } }, center },
  output: { uv: { type: Vec2, label: 'UV' } },
  body: ({ uv, angle, center }, ctx) => {
    const radians = ctx.declare('float', `${angle.expr} * 6.2831853`, 'a').expr
    const offset = ctx.declare('vec2', `${uv.expr} - ${center.expr}`, 'p').expr
    // Lookup turned by -angle turns the picture by +angle
    return {
      uv: ctx.declare(
        'vec2',
        `vec2(${offset}.x * cos(${radians}) + ${offset}.y * sin(${radians}), ${offset}.y * cos(${radians}) - ${offset}.x * sin(${radians})) + ${center.expr}`,
      ),
    }
  },
})

export const segmentSplitNode = defineNode('segmentSplit', {
  title: 'Segment Split',
  description:
    'Cut a strip into equal segments. Local restarts at 0 in each one, Segment is its number, and Fraction spreads the segments over 0 to 1 for picking a color per segment.',
  category: 'math',
  input: {
    position: { type: Float, default: { expr: 'uv.x', label: 'uv.x' } },
    count: { type: Float, default: 4, props: { min: 1, step: 1, decimals: 0 } },
  },
  output: { local: Float, segment: Float, fraction: Float },
  body: ({ position, count }, ctx) => {
    const segments = ctx.declare('float', `max(1.0, floor(${count.expr}))`, 'n').expr
    const scaled = ctx.declare('float', `clamp(${position.expr}, 0.0, 0.999999) * ${segments}`, 'scaled').expr
    const segment = ctx.declare('float', `floor(${scaled})`, 'segment')
    return {
      local: ctx.declare('float', `fract(${scaled})`),
      segment,
      fraction: ctx.declare('float', `${segment.expr} / max(1.0, ${segments} - 1.0)`, 'fraction'),
    }
  },
})
