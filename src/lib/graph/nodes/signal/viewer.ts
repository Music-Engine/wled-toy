import { defineNode, Float } from '@/lib/graph/authoring'

export const viewerNode = defineNode('viewer', {
  title: 'Viewer',
  description: 'Plots a per-frame value over the last few seconds, for seeing what a chain of per-frame nodes does. Passes the value on unchanged.',
  category: 'signal',
  // Draws nothing, but must run each frame to have a value to show
  isOutput: true,
  input: { value: { type: Float, default: 0 } },
  output: { value: Float },
  body: ({ value }) => ({ value }),
  probe: 'value',
})
