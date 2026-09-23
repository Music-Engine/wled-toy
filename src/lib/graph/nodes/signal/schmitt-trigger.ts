import { defineNode, Float } from '@/lib/graph/authoring'

const level = (fallback: number) => ({ type: Float, default: fallback, props: { decimals: 3 } })

export const schmittTriggerNode = defineNode('schmittTrigger', {
  title: 'Threshold',
  description: 'Turns on above High and off below Low. The gap between them stops a noisy signal from chattering.',
  category: 'signal',
  input: { signal: { type: Float, default: 0 }, low: level(0.4), high: level(0.6) },
  output: { gate: Float },
  state: () => ({ on: false }),
  frame: ({ signal, low, high }, { state }) => {
    if (!state.on && signal >= high) state.on = true
    else if (state.on && signal <= low) state.on = false
    return { gate: state.on ? 1 : 0 }
  },
})
