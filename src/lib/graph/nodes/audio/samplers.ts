import { HISTORY_ROWS } from '@/lib/audio/textures'
import { AudioStream, defineNode, Float, SpectrumStream } from '@/lib/graph/authoring'

const alongStrip = { type: Float, default: { expr: 'uv.x', label: 'uv.x' } } as const

export const spectrumNode = defineNode('spectrum', {
  title: 'Spectrum',
  description: `Band level at a position: 0 is the lowest band, 1 the highest, log or mel spaced so every octave gets a similar share of the strip. Age looks back: 0 is now, 1 is ${HISTORY_ROWS} analysis hops ago (about 2.7 s at the default hop); feed it the strip position for a scrolling waterfall.`,
  category: 'audio',
  varies: 'pixel',
  input: {
    spectrum: SpectrumStream,
    position: alongStrip,
    age: { type: Float, default: 0, props: { min: 0, max: 1 } },
  },
  output: { level: Float },
  body: ({ spectrum, position, age }, ctx) => ({ level: ctx.declare('float', `historyAt(${spectrum?.slot ?? 0}, ${position.expr}, ${age.expr})`) }),
})

export const chromaNode = defineNode('chroma', {
  title: 'Chroma',
  description: 'Strength of each of the 12 pitch classes, C first. Position 0 to 1 sweeps C to B, so a strip shows which notes are sounding. Only the FFT node\'s Lowest to Highest Hz count (raise Lowest to keep the kick out), and a bigger Window tells low notes apart.',
  category: 'audio',
  varies: 'pixel',
  input: { spectrum: SpectrumStream, position: alongStrip },
  output: { level: Float },
  body: ({ spectrum, position }, ctx) => ({ level: ctx.declare('float', `chromaAt(${spectrum?.slot ?? 0}, floor(clamp(${position.expr}, 0.0, 0.9999) * 12.0))`) }),
})

export const waveformNode = defineNode('waveform', {
  title: 'Waveform',
  description: 'The raw signal, -1 to 1. Position sweeps across Span seconds of audio ending Delay seconds ago; the delay line holds about a third of a second.',
  category: 'audio',
  varies: 'pixel',
  input: {
    audio: AudioStream,
    position: alongStrip,
    span: { type: Float, label: 'Span (s)', default: 0.01, props: { min: 0, max: 0.3, decimals: 3 } },
    delay: { type: Float, label: 'Delay (s)', default: 0, props: { min: 0, max: 0.3, decimals: 3 } },
  },
  output: { sample: Float },
  body: ({ position, span, delay }, ctx) => ({ sample: ctx.declare('float', `waveformAt(((1.0 - ${position.expr}) * ${span.expr} + ${delay.expr}) * iAudioHeads.z)`) }),
})
