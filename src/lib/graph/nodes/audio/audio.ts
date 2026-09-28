import { AUDIO_FEATURES } from '@/lib/audio/features'
import { DEFAULT_ANALYSIS, DEFAULT_AUDIO, MAX_ANALYSES, systemAudioBlocked, type AnalysisSettings, type AudioSourceRequest } from '@/lib/audio/settings'
import { AudioStream, defineNode, Enum, Float, Int, findResourceIndex, SpectrumStream } from '@/lib/graph/authoring'
import { audioReadsChunk } from '@/lib/graph/nodes/glsl/audio'
import { sameJson } from '@/lib/util/json'

const SOURCES = [{ value: 'file', label: 'Song' }, { value: 'device', label: 'Capture Device' }, { value: 'loopback', label: 'System audio' }] as const
const CHANNELS = [{ value: 'mono', label: 'Mono Sum' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }] as const
const WINDOWS = [{ value: 'hann', label: 'Hann' }, { value: 'hamming', label: 'Hamming' }, { value: 'blackman', label: 'Blackman' }] as const
const SCALES = [{ value: 'mel', label: 'Mel Bands' }, { value: 'log', label: 'Log Bands' }] as const
const toSizeOptions = (values: number[]) => values.map((n) => ({ value: String(n), label: `${n} samples` }))

export const audioSourceNode = defineNode('audioSource', {
  title: 'Audio Source',
  description: 'Where the sound comes from: your song, a capture device, or system audio (in a browser, a Chrome tab or, on Windows, the screen). It is the input of the whole graph, so audio nodes with nothing linked listen to it too. One source is live at a time.',
  category: 'audio',
  // Sets the graph's input, linked or not
  isOutput: true,
  input: {
    source: { type: Enum(SOURCES), label: '', default: DEFAULT_AUDIO.source, linkable: false, props: { label: 'Source' } },
    channel: { type: Enum(CHANNELS), label: '', default: DEFAULT_AUDIO.channel, linkable: false, props: { label: 'Channel' } },
    agcRelease: { type: Float, label: 'Gain Release (s)', default: DEFAULT_AUDIO.agc.release, linkable: false, props: { min: 0.1, max: 60, decimals: 1 } },
    floorDb: { type: Float, label: 'Gain Floor (dB)', default: DEFAULT_AUDIO.agc.floorDb, linkable: false, props: { min: -90, max: 0, decimals: 0 } },
    gateDb: { type: Float, label: 'Silence Gate (dB)', default: DEFAULT_AUDIO.gate.thresholdDb, linkable: false, props: { min: -90, max: 0, decimals: 0 } },
    gateHold: { type: Float, label: 'Gate Hold (s)', default: DEFAULT_AUDIO.gate.hold, linkable: false, props: { min: 0, max: 5, decimals: 2 } },
  },
  output: { audio: AudioStream },
  resolve: ({ source, channel, agcRelease, floorDb, gateDb, gateHold }, resources) => {
    const request: AudioSourceRequest = { source, channel, agc: { release: agcRelease, floorDb }, gate: { thresholdDb: gateDb, hold: gateHold } }
    const issues = []
    if (findResourceIndex(resources, 'audioSource', request) > 0) issues.push('Another Audio Source with different settings is live; one source runs at a time')
    const blocked = source === 'loopback' && systemAudioBlocked()
    if (blocked) issues.push(blocked)
    return { streams: { audio: { source: true } }, requires: [{ kind: 'audioSource', config: request }], issues }
  },
})

export const fftNode = defineNode('fft', {
  title: 'FFT',
  description: `Splits audio into frequency bands. A larger window resolves bass notes and reacts slower; a smaller hop updates more often. Up to ${MAX_ANALYSES - 1} FFT nodes with different settings can work next to the default one.`,
  category: 'audio',
  input: {
    audio: AudioStream,
    windowSize: { type: Enum(toSizeOptions([512, 1024, 2048, 4096, 8192])), label: 'Window', default: String(DEFAULT_ANALYSIS.windowSize), linkable: false },
    hop: { type: Enum(toSizeOptions([128, 256, 512, 1024, 2048])), label: 'Hop', default: String(DEFAULT_ANALYSIS.hop), linkable: false },
    window: { type: Enum(WINDOWS), label: 'Window Shape', default: DEFAULT_ANALYSIS.window, linkable: false },
    scale: { type: Enum(SCALES), label: 'Band Spacing', default: DEFAULT_ANALYSIS.scale, linkable: false },
    bands: { type: Int, default: DEFAULT_ANALYSIS.bands, linkable: false, props: { min: 12, max: 256, step: 4, decimals: 0 } },
    fmin: { type: Float, label: 'Lowest (Hz)', default: DEFAULT_ANALYSIS.fmin, linkable: false, props: { min: 20, max: 2000, decimals: 0 } },
    fmax: { type: Float, label: 'Highest (Hz)', default: DEFAULT_ANALYSIS.fmax, linkable: false, props: { min: 1000, max: 22000, decimals: 0 } },
  },
  output: { spectrum: SpectrumStream },
  resolve: ({ windowSize, hop, window, scale, bands, fmin, fmax }, resources) => {
    // Spread over default keeps key order: equal settings must serialize equally to share a slot
    const settings: AnalysisSettings = { ...DEFAULT_ANALYSIS, windowSize: Number(windowSize), hop: Number(hop), window, scale, bands, fmin, fmax }
    if (sameJson(settings, DEFAULT_ANALYSIS)) return { streams: { spectrum: { slot: 0 } } }
    const requires = [{ kind: 'analysis', config: settings }]
    const slot = findResourceIndex(resources, 'analysis', settings) + 1
    if (slot < MAX_ANALYSES) return { streams: { spectrum: { slot } }, requires }
    const issue = `Only ${MAX_ANALYSES - 1} FFT settings besides the default can be active at once; this one falls back to the default`
    return { streams: { spectrum: { slot: 0 } }, requires, issues: [issue] }
  },
})

export const audioNode = defineNode('audio', {
  title: 'Audio',
  description: 'Everything measured from an audio stream once per frame: loudness, onsets, the beat clock, brightness, and the level of named ranges of the mix. Levels are gain-controlled, so they fill 0 to 1 whatever the volume.',
  category: 'audio',
  input: { audio: AudioStream },
  output: {
    level: Float, rms: { type: Float, label: 'RMS' }, peak: Float, gate: Float,
    onset: Float, beat: Float, beatPhase: Float, bpm: { type: Float, label: 'BPM' },
    centroid: { type: Float, label: 'Brightness' }, flatness: { type: Float, label: 'Noisiness' },
    sub: Float, kick: Float, lowMid: Float, vocal: Float, presence: Float, air: Float,
  },
  resolve: () => ({ requires: [{ kind: 'audioFeatures', config: true }] }),
  body: (_, ctx) => {
    ctx.include(audioReadsChunk)
    return Object.fromEntries(AUDIO_FEATURES.map((name, i) => [name, { expr: `iAudioFeatures[${Math.floor(i / 4)}].${'xyzw'[i % 4]}`, type: 'float' }])) as never
  },
})

export const bandSplitNode = defineNode('bandSplit', {
  title: 'Band Split',
  description: 'The level of one frequency range, for following a single part of the mix: set it around a kick, a voice, a hi-hat. Link an FFT with a large window to tell bass notes apart.',
  category: 'audio',
  prefers: 'frame',
  input: {
    spectrum: SpectrumStream,
    low: { type: Float, label: 'Low (Hz)', default: 60, props: { min: 20, max: 20000, decimals: 0 } },
    high: { type: Float, label: 'High (Hz)', default: 150, props: { min: 20, max: 20000, decimals: 0 } },
  },
  output: { level: Float },
  resolve: ({ spectrum }) => ({ requires: [{ kind: 'spectra', config: spectrum?.slot ?? 0 }] }),
  body: ({ spectrum, low, high }, ctx) => {
    ctx.include(audioReadsChunk)
    return { level: ctx.declare('float', `spectrumPeak(${spectrum?.slot ?? 0}, ${low.expr}, ${high.expr})`) }
  },
})
