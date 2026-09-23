import { defineNode } from '@/lib/graph/define/define'
import { AudioStream, Enum, Float } from '@/lib/graph/define/socket-types'
import { approach, seconds } from '@/lib/graph/nodes/signal/shared'

const MODES = [
  { value: 'level', label: 'Level (gain controlled)' }, { value: 'rms', label: 'RMS' }, { value: 'peak', label: 'Peak' },
] as const

export const audioSignalNode = defineNode('audioSignal', {
  title: 'Audio to Signal',
  description: 'The loudness of an audio stream as one per-frame number, smoothed with Attack and Release so it can drive anything a knob can. Level follows gain control and fills 0 to 1; RMS and Peak are the raw values.',
  category: 'audio',
  input: {
    mode: { type: Enum(MODES), label: '', default: 'level', connectable: false, props: { label: 'Measure' } },
    audio: AudioStream,
    attack: seconds(0.01),
    release: seconds(0.15),
  },
  output: { signal: Float },
  standalone: { signal: 'energy()' },
  state: () => ({ value: 0 }),
  run: ({ mode, attack, release }, state, { dt, audio }) => {
    const f = audio?.analyses[0]
    const target = !f ? 0 : mode === 'rms' ? f.rms : mode === 'peak' ? f.peak : f.level
    state.value += (target - state.value) * approach(dt, target > state.value ? attack : release)
    return { signal: state.value }
  },
})
