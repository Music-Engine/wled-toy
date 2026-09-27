import { defineNode, Float } from '@/lib/graph/authoring'

export const viewerNode = defineNode('viewer', {
  title: 'Viewer',
  description: 'Plots a per-frame value over the last few seconds, for seeing what a control chain does. Passes the value on unchanged.',
  category: 'signal',
  // it draws nothing, but has to run each frame to have something to show
  isOutput: true,
  input: { value: { type: Float, default: 0 } },
  output: { value: Float },
  run: ({ value }) => ({ value }),
})
