import { defineNode, Enum, Float } from '@/lib/graph/authoring'

const SHAPES = [
  { value: 'sine', label: 'Sine' }, { value: 'triangle', label: 'Triangle' }, { value: 'saw', label: 'Saw' }, { value: 'square', label: 'Square' },
  { value: 'bounce', label: 'Bounce' }, { value: 'pulse', label: 'Pulse' }, { value: 'randomSteps', label: 'Random Steps' }, { value: 'smoothRandom', label: 'Smooth Random' },
] as const
type Shape = (typeof SHAPES)[number]['value']

/** Every periodic 0..1 signal: along the strip, over time, or a frame chain's LFO; unlinked it follows shader time */
export const waveNode = defineNode('wave', ({ shape = 'sine' }: { shape?: Shape }) => ({
  title: 'Wave',
  description: 'A 0 to 1 wave of the given shape: Frequency cycles per unit of Input, shifted by Phase. Random Steps holds a new random value each cycle; Smooth Random glides between them.',
  category: 'signal',
  input: {
    shape: { type: Enum(SHAPES), label: '', default: 'sine', linkable: false, props: { label: 'Shape' } },
    input: { type: Float, default: { expr: 'iTime', label: 'time', inFramePass: true } },
    frequency: { type: Float, default: 1, props: { step: 0.1, decimals: 3 } },
    phase: { type: Float, default: 0, props: { decimals: 3 } },
    ...(shape === 'square' && { duty: { type: Float, default: 0.5, props: { min: 0, max: 1 } } }),
    ...(shape === 'pulse' && { width: { type: Float, default: 0.1, props: { min: 0.001, max: 1, decimals: 3 } } }),
  },
  output: { value: Float },
  body: (input, ctx) => {
    const cycle = ctx.declare('float', `${input.input.expr} * ${input.frequency.expr} + ${input.phase.expr}`, 'cycle').expr
    const phase = ctx.declare('float', `fract(${cycle})`, 'p').expr
    const cell = `floor(${cycle})`
    const toHash = (n: string) => `fract(sin(${n} * 127.1) * 43758.5453)`
    const value = shape === 'sine' ? `0.5 - 0.5 * cos(6.2831853 * ${phase})`
      : shape === 'triangle' ? `1.0 - abs(2.0 * ${phase} - 1.0)`
        : shape === 'saw' ? phase
          : shape === 'square' ? `step(${phase}, ${input.duty!.expr})`
            : shape === 'bounce' ? `abs(sin(3.14159265 * ${phase}))`
              : shape === 'pulse' ? `exp(-pow(${phase} / max(${input.width!.expr}, 0.001), 2.0))`
                : shape === 'randomSteps' ? toHash(cell)
                  : `mix(${toHash(cell)}, ${toHash(`(${cell} + 1.0)`)}, ${phase} * ${phase} * (3.0 - 2.0 * ${phase}))`
    return { value: ctx.declare('float', value) }
  },
}))
