import { defineNode } from '@/lib/graph/define/define'
import { Float } from '@/lib/graph/define/socket-types'

export const timeNode = defineNode('time', {
  title: 'Time',
  description: 'The clock: seconds since reset, seconds since the last frame, and the frame count. Per pixel it is the shader\'s time; feeding a per-frame node, it is the engine\'s.',
  category: 'input',
  input: {},
  output: { time: Float, delta: { type: Float, label: 'Delta Time' }, frame: Float },
  exec: () => ({ time: { expr: 'iTime', type: 'float' }, delta: { expr: 'iTimeDelta', type: 'float' }, frame: { expr: 'float(iFrame)', type: 'float' } }),
  run: (_, __, { time, dt, frameIndex }) => ({ time, delta: dt, frame: frameIndex }),
})
