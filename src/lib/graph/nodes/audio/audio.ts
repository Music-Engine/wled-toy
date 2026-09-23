import { rangePeak, type Features } from '@/lib/audio/dsp'
import { DEFAULT_ANALYSIS, DEFAULT_AUDIO, MAX_ANALYSES, systemAudioBlocked, type AnalysisSettings, type AudioSettings } from '@/lib/audio/service'
import { defineNode } from '@/lib/graph/define/define'
import type { FrameInfo } from '@/lib/graph/define/node'
import { AudioStream, Enum, Float, Int, SpectrumStream } from '@/lib/graph/define/types'

const SOURCES = [{ value: 'file', label: 'Song' }, { value: 'device', label: 'Capture Device' }, { value: 'loopback', label: 'System audio' }] as const
const CHANNELS = [{ value: 'mono', label: 'Mono Sum' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }] as const
const WINDOWS = [{ value: 'hann', label: 'Hann' }, { value: 'hamming', label: 'Hamming' }, { value: 'blackman', label: 'Blackman' }] as const
const SCALES = [{ value: 'mel', label: 'Mel Bands' }, { value: 'log', label: 'Log Bands' }] as const
const sizes = (values: number[]) => values.map((n) => ({ value: String(n), label: `${n} samples` }))

/** Which device is captured is not a node value: devices differ per machine, so the node's body picks it on the spot. */
export type AudioSourceRequest = Omit<AudioSettings, 'deviceId'>

export const audioSourceNode = defineNode('audioSource', {
  title: 'Audio Source',
  description: 'Where the sound comes from: your song, a capture device, or system audio (in a browser, a Chrome tab or, on Windows, the screen). It is the input of the whole graph, so audio nodes with nothing linked listen to it too. One source is live at a time.',
  category: 'audio',
  // it sets the graph's input whether or not anything is linked to it
  isOutput: true,
  input: {
    source: { type: Enum(SOURCES), label: '', default: DEFAULT_AUDIO.source, connectable: false, props: { label: 'Source' } },
    channel: { type: Enum(CHANNELS), label: '', default: DEFAULT_AUDIO.channel, connectable: false, props: { label: 'Channel' } },
    agcRelease: { type: Float, label: 'Gain Release (s)', default: DEFAULT_AUDIO.agc.release, connectable: false, props: { min: 0.1, max: 60, decimals: 1 } },
    floorDb: { type: Float, label: 'Gain Floor (dB)', default: DEFAULT_AUDIO.agc.floorDb, connectable: false, props: { min: -90, max: 0, decimals: 0 } },
    gateDb: { type: Float, label: 'Silence Gate (dB)', default: DEFAULT_AUDIO.gate.thresholdDb, connectable: false, props: { min: -90, max: 0, decimals: 0 } },
    gateHold: { type: Float, label: 'Gate Hold (s)', default: DEFAULT_AUDIO.gate.hold, connectable: false, props: { min: 0, max: 5, decimals: 2 } },
  },
  output: { audio: AudioStream },
  resolve: ({ source, channel, agcRelease, floorDb, gateDb, gateHold }, env) => {
    const request: AudioSourceRequest = { source, channel, agc: { release: agcRelease, floorDb }, gate: { thresholdDb: gateDb, hold: gateHold } }
    if (env.intern('audioSource', request) > 0) env.issue('Another Audio Source with different settings is live; one source runs at a time')
    const blocked = source === 'loopback' && systemAudioBlocked()
    if (blocked) env.issue(blocked)
    return { audio: { source: true } }
  },
})

export const fftNode = defineNode('fft', {
  title: 'FFT',
  description: `Splits audio into frequency bands. A larger window resolves bass notes and reacts slower; a smaller hop updates more often. Up to ${MAX_ANALYSES - 1} FFT nodes with different settings can run next to the default one.`,
  category: 'audio',
  input: {
    audio: AudioStream,
    windowSize: { type: Enum(sizes([512, 1024, 2048, 4096, 8192])), label: 'Window', default: String(DEFAULT_ANALYSIS.windowSize), connectable: false },
    hop: { type: Enum(sizes([128, 256, 512, 1024, 2048])), label: 'Hop', default: String(DEFAULT_ANALYSIS.hop), connectable: false },
    window: { type: Enum(WINDOWS), label: 'Window Shape', default: DEFAULT_ANALYSIS.window, connectable: false },
    scale: { type: Enum(SCALES), label: 'Band Spacing', default: DEFAULT_ANALYSIS.scale, connectable: false },
    bands: { type: Int, default: DEFAULT_ANALYSIS.bands, connectable: false, props: { min: 12, max: 256, step: 4, decimals: 0 } },
    fmin: { type: Float, label: 'Lowest (Hz)', default: DEFAULT_ANALYSIS.fmin, connectable: false, props: { min: 20, max: 2000, decimals: 0 } },
    fmax: { type: Float, label: 'Highest (Hz)', default: DEFAULT_ANALYSIS.fmax, connectable: false, props: { min: 1000, max: 22000, decimals: 0 } },
  },
  output: { spectrum: SpectrumStream },
  resolve: ({ windowSize, hop, window, scale, bands, fmin, fmax }, env) => {
    // spread over the default so the keys keep its order: equal settings must serialize equally to share a slot
    const settings: AnalysisSettings = { ...DEFAULT_ANALYSIS, windowSize: Number(windowSize), hop: Number(hop), window, scale, bands, fmin, fmax }
    if (JSON.stringify(settings) === JSON.stringify(DEFAULT_ANALYSIS)) return { spectrum: { slot: 0 } }
    // slot 0 is the default analysis, so the first distinct FFT is slot 1
    const slot = env.intern('analysis', settings) + 1
    if (slot < MAX_ANALYSES) return { spectrum: { slot } }
    env.issue(`Only ${MAX_ANALYSES - 1} FFT settings besides the default can run at once; this one falls back to the default`)
    return { spectrum: { slot: 0 } }
  },
})

const analysis = (frame: FrameInfo, slot = 0): Features | undefined => frame.audio?.analyses[slot] ?? undefined

// named ranges of a mix, in Hz; the outputs follow the loudest partial inside each
const RANGES = { sub: [20, 60], kick: [60, 150], lowMid: [150, 500], vocal: [500, 2000], presence: [2000, 6000], air: [6000, 16000] } as const

const rangeLevel = (f: Features, sampleRate: number, low: number, high: number) =>
  (f.gate ? Math.sqrt(Math.min(1, rangePeak(f.spectrum, sampleRate, f.spectrum.length * 2, low, high) * f.gain)) : 0)

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
  // sent to shader mode there is no analyzer; the prelude's own audio helpers stand in where they can
  standalone: { level: 'energy()', kick: 'bass()', sub: 'bass()', lowMid: 'mid()', vocal: 'mid()', presence: 'treble()', air: 'treble()', beat: 'beat(0.5)' },
  run: (_, __, frame) => {
    const f = analysis(frame)
    if (!f) return { level: 0, rms: 0, peak: 0, gate: 0, onset: 0, beat: 0, beatPhase: 0, bpm: 120, centroid: 0, flatness: 0, sub: 0, kick: 0, lowMid: 0, vocal: 0, presence: 0, air: 0 }
    const range = ([low, high]: readonly [number, number]) => rangeLevel(f, frame.audio!.sampleRate, low, high)
    return {
      level: f.level, rms: f.rms, peak: f.peak, gate: Number(f.gate), onset: Number(f.onset), beat: Number(f.beat), beatPhase: f.beatPhase, bpm: f.bpm,
      centroid: f.centroid, flatness: f.flatness,
      sub: range(RANGES.sub), kick: range(RANGES.kick), lowMid: range(RANGES.lowMid), vocal: range(RANGES.vocal), presence: range(RANGES.presence), air: range(RANGES.air),
    }
  },
})

export const bandSplitNode = defineNode('bandSplit', {
  title: 'Band Split',
  description: 'The level of one frequency range, for following a single part of the mix: set it around a kick, a voice, a hi-hat. Link an FFT with a large window to tell bass notes apart.',
  category: 'audio',
  input: {
    spectrum: SpectrumStream,
    low: { type: Float, label: 'Low (Hz)', default: 60, props: { min: 20, max: 20000, decimals: 0 } },
    high: { type: Float, label: 'High (Hz)', default: 150, props: { min: 20, max: 20000, decimals: 0 } },
  },
  output: { level: Float },
  run: ({ spectrum, low, high }, _, frame) => {
    const f = analysis(frame, spectrum?.slot)
    return { level: f ? rangeLevel(f, frame.audio!.sampleRate, low, high) : 0 }
  },
})
