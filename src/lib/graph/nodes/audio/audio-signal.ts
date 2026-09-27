import { AudioStream, defineNode, Enum, Float } from '@/lib/graph/authoring'
import { approach } from '@/lib/graph/nodes/shared/signal'
import { seconds } from '@/lib/graph/nodes/shared/sockets'
import { audioReadsChunk } from '@/lib/graph/nodes/glsl/audio'

const MODES = [
  { value: 'level', label: 'Level (gain controlled)' }, { value: 'rms', label: 'RMS' }, { value: 'peak', label: 'Peak' },
] as const

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
  state: { value: Float },
  frameOnlyInOldPipeline: true,
  // level, rms and peak are the first three of iAudioFeatures; the step is approach() over iTimeDelta
  body: ({ mode, attack, release }, ctx) => {
    ctx.include(audioReadsChunk)
    const value = ctx.state.value.expr
    const target = ctx.declare('float', `iAudioFeatures[0].${mode === 'rms' ? 'y' : mode === 'peak' ? 'z' : 'x'}`, 'target').expr
    const time = ctx.declare('float', `${target} > ${value} ? ${attack.expr} : ${release.expr}`, 'seconds').expr
    ctx.emit(`${value} += (${target} - ${value}) * (${time} <= 0.0 ? 1.0 : 1.0 - exp(-iTimeDelta / ${time}));`)
    return { signal: ctx.state.value }
  },
  frame: ({ mode, attack, release }, { state, dt, audio }) => {
    const f = audio?.analyses[0]
    const target = !f ? 0 : mode === 'rms' ? f.rms : mode === 'peak' ? f.peak : f.level
    state.value += (target - state.value) * approach(dt, target > state.value ? attack : release)
    return { signal: state.value }
  },
})
