import { defineNode, Enum, Float } from '@/lib/graph/authoring'

const SHAPES = [
  { value: 'sine', label: 'Sine' }, { value: 'triangle', label: 'Triangle' }, { value: 'saw', label: 'Saw' }, { value: 'square', label: 'Square' },
  { value: 'bounce', label: 'Bounce' }, { value: 'pulse', label: 'Pulse' }, { value: 'randomSteps', label: 'Random Steps' }, { value: 'smoothRandom', label: 'Smooth Random' },
] as const
type Shape = (typeof SHAPES)[number]['value']

const hash = (n: number) => {
  const x = Math.sin(n * 127.1) * 43758.5453
  return x - Math.floor(x)
}

/**
 * One node for every periodic 0..1 signal: a per-pixel wave along the strip or over time, and the LFO of a per-frame chain.
 * Per pixel it defaults to the shader's time; per frame to the engine clock; link a position for a wave along the strip.
 */
export const waveNode = defineNode('wave', ({ shape = 'sine' }: { shape?: Shape }) => ({
  title: 'Wave',
  description: 'A 0 to 1 wave of the given shape: Frequency cycles per unit of Input, shifted by Phase. Random Steps holds a new random value each cycle; Smooth Random glides between them.',
  category: 'signal',
  input: {
    shape: { type: Enum(SHAPES), label: '', default: 'sine', linkable: false, props: { label: 'Shape' } },
    input: { type: Float, default: { expr: 'iTime', label: 'time', frame: 'time' } },
    frequency: { type: Float, default: 1, props: { step: 0.1, decimals: 3 } },
    phase: { type: Float, default: 0, props: { decimals: 3 } },
    ...(shape === 'square' && { duty: { type: Float, default: 0.5, props: { min: 0, max: 1 } } }),
    ...(shape === 'pulse' && { width: { type: Float, default: 0.1, props: { min: 0.001, max: 1, decimals: 3 } } }),
  },
  output: { value: Float },
  body: (input, ctx) => {
    const cycle = ctx.declare('float', `${input.input.expr} * ${input.frequency.expr} + ${input.phase.expr}`, 'cycle').expr
    const p = ctx.declare('float', `fract(${cycle})`, 'p').expr
    const cell = `floor(${cycle})`
    const random = (n: string) => `fract(sin(${n} * 127.1) * 43758.5453)`
    const value = shape === 'sine' ? `0.5 - 0.5 * cos(6.2831853 * ${p})`
      : shape === 'triangle' ? `1.0 - abs(2.0 * ${p} - 1.0)`
        : shape === 'saw' ? p
          : shape === 'square' ? `step(${p}, ${input.duty!.expr})`
            : shape === 'bounce' ? `abs(sin(3.14159265 * ${p}))`
              : shape === 'pulse' ? `exp(-pow(${p} / max(${input.width!.expr}, 0.001), 2.0))`
                : shape === 'randomSteps' ? random(cell)
                  : `mix(${random(cell)}, ${random(`(${cell} + 1.0)`)}, ${p} * ${p} * (3.0 - 2.0 * ${p}))`
    return { value: ctx.declare('float', value) }
  },
  frame: (input) => {
    const cycle = input.input * input.frequency + input.phase
    const p = cycle - Math.floor(cycle)
    const cell = Math.floor(cycle)
    const smooth = p * p * (3 - 2 * p)
    const value = shape === 'sine' ? 0.5 - 0.5 * Math.cos(2 * Math.PI * p)
      : shape === 'triangle' ? 1 - Math.abs(2 * p - 1)
        : shape === 'saw' ? p
          : shape === 'square' ? Number(p <= ((input.duty as number | undefined) ?? 0.5))
            : shape === 'bounce' ? Math.abs(Math.sin(Math.PI * p))
              : shape === 'pulse' ? Math.exp(-((p / Math.max((input.width as number | undefined) ?? 0.1, 0.001)) ** 2))
                : shape === 'randomSteps' ? hash(cell)
                  : hash(cell) + (hash(cell + 1) - hash(cell)) * smooth
    return { value }
  },
}))
