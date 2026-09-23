import { defineNode, Float } from '@/lib/graph/authoring'

export const timeNode = defineNode('time', {
  title: 'Time',
  description: 'The clock: seconds since reset, seconds since the last frame, and the frame count. Per pixel it is the shader\'s time; feeding a per-frame node, it is the engine\'s.',
  category: 'input',
  input: {},
  output: { time: Float, delta: { type: Float, label: 'Delta Time' }, frame: Float },
  pixel: () => ({ time: { expr: 'iTime', type: 'float' }, delta: { expr: 'iTimeDelta', type: 'float' }, frame: { expr: 'float(iFrame)', type: 'float' } }),
  frame: (_, { time, dt, frameIndex }) => ({ time, delta: dt, frame: frameIndex }),
})
