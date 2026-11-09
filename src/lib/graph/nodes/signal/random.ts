import { defineNode, Float } from '@/lib/graph/authoring'

export const randomNode = defineNode('random', {
  title: 'Random',
  description: 'A repeatable pseudo-random 0 to 1 for each seed. Seed it with the LED index for per-pixel sparkle or a Counter for a new value per beat.',
  category: 'converter',
  input: { seed: { type: Float, default: { expr: 'ledIndex', label: 'LED index' } } },
  output: { value: Float },
  body: ({ seed }, ctx) => ({ value: ctx.declare('float', `fract(sin(${seed.expr} * 127.1 + 311.7) * 43758.5453)`) }),
})
