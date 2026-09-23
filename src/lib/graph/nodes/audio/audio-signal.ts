import { AudioStream, defineNode, Enum, Float } from '@/lib/graph/authoring'

const MODES = [
  { value: 'level', label: 'Level (gain controlled)' }, { value: 'rms', label: 'RMS' }, { value: 'peak', label: 'Peak' },
] as const

// same shape as the signal category's helpers; a node may not import from another category
const seconds = (fallback: number) => ({ type: Float, default: fallback, props: { min: 0, step: 0.01, decimals: 3 } })
const approach = (dt: number, span: number) => (span <= 0 ? 1 : 1 - Math.exp(-dt / span))

export const audioSignalNode = defineNode('audioSignal', {
  title: 'Audio to Signal',
  description: 'The loudness of an audio stream as one per-frame number, smoothed with Attack and Release so it can drive anything a knob can. Level follows the automatic gain and fills 0 to 1; RMS and Peak are the raw values.',
  category: 'audio',
  input: {
    mode: { type: Enum(MODES), label: '', default: 'level', linkable: false, props: { label: 'Measure' } },
    audio: AudioStream,
    attack: seconds(0.01),
    release: seconds(0.15),
  },
  output: { signal: Float },
  state: () => ({ value: 0 }),
  frame: ({ mode, attack, release }, { state, dt, audio }) => {
    const f = audio?.analyses[0]
    const target = !f ? 0 : mode === 'rms' ? f.rms : mode === 'peak' ? f.peak : f.level
    state.value += (target - state.value) * approach(dt, target > state.value ? attack : release)
    return { signal: state.value }
  },
})
