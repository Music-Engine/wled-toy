import { Analyzer, type Features } from '@/lib/audio/dsp'
import { computeAudioFeatures } from '@/lib/audio/features'
import { DEFAULT_ANALYSIS, DEFAULT_AUDIO, MAX_ANALYSES, type AnalysisSettings, type AudioSourceRequest } from '@/lib/audio/settings'
import { AUDIO_BINS, AudioTextures } from '@/lib/audio/textures'
import type { AudioFrame } from './cpp'

export const SAMPLE_RATE = 48000
export const FPS = 30
export const SECONDS = 10
export const BEAT = 0.5
export const BREAKDOWN = [6, 8]

export const findSection = (t: number) => (t < BREAKDOWN[0] ? 'groove' : t < BREAKDOWN[1] ? 'breakdown' : 'drop')

/**
 * 120 BPM, one chord per 2 s bar: three bars groove, one breakdown (pad and lead only), one drop. Parts sit in separate
 * Audio node ranges so each output follows one instrument: kick in sub and kick, bass in lowMid, pad and lead in vocal,
 * snare and hats in presence and air
 */
export function synthesizeTrack(seconds = SECONDS): Float32Array {
  const out = new Float32Array(seconds * SAMPLE_RATE)
  let seed = 1
  let lastNoise = 0
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const noise = seed / 2 ** 31 - 1
    out[i] = mixSample(i / SAMPLE_RATE, noise, (noise - lastNoise) / 2)
    lastNoise = noise
  }
  return out
}

// Am, C, Em, Dm (breakdown), Am (drop)
const CHORDS = [
  [220, 261.63, 329.63],
  [261.63, 329.63, 392],
  [329.63, 392, 493.88],
  [293.66, 349.23, 440],
  [220, 261.63, 329.63],
]

function mixSample(t: number, noise: number, hiss: number): number {
  const playTone = (hz: number, at: number) => Math.sin(2 * Math.PI * hz * at)
  const part = findSection(t % SECONDS)
  const chord = CHORDS[Math.floor((t % SECONDS) / 2)]
  const sinceBeat = t % BEAT
  const sinceEighth = t % (BEAT / 2)
  const eighth = Math.floor(t / (BEAT / 2))

  const kick = 0.8 * Math.sin(2 * Math.PI * (45 * sinceBeat + 75 * 0.05 * (1 - Math.exp(-sinceBeat / 0.05)))) * Math.exp(-sinceBeat / 0.15)
  const snare = Math.floor(t / BEAT) % 2 === 1 ? (0.6 * noise + 0.2 * playTone(190, sinceBeat)) * Math.exp(-sinceBeat / 0.07) : 0
  const hat = eighth % 2 === 1 || part === 'drop' ? 0.6 * hiss * Math.exp(-sinceEighth / (part === 'drop' ? 0.05 : 0.025)) : 0
  const bass = eighth % 2 === 1 ? 0.25 * playTone(chord[0], sinceEighth) * Math.exp(-sinceEighth / 0.15) : 0
  const pad = chord.reduce((sum, hz) => sum + playTone(hz * 2, t % 2) + 0.3 * playTone(hz * 4, t % 2), 0) * 0.03
  const lead = (part === 'drop' ? 0.2 : 0.12) * playTone(chord[[0, 1, 2, 1][eighth % 4]] * 4, sinceEighth) * Math.exp(-sinceEighth / 0.12)
  return part === 'breakdown' ? 0.25 * (pad + lead) : 0.6 * (kick + snare + hat + bass + pad + lead)
}

export interface Slot {
  hop: number
  fed: number
  analyzer: Analyzer
  textures: AudioTextures
  features: Features | null
  pending: { onset: boolean; beat: boolean }
}

/** As AudioService opens them: slot 0 default analysis, FFT nodes add slots, Audio Source sets gain and gate */
export function openSlots(program: { resources: Record<string, unknown[]> }, sampleRate = SAMPLE_RATE): Slot[] {
  const [source = DEFAULT_AUDIO] = (program.resources.audioSource ?? []) as AudioSourceRequest[]
  return [DEFAULT_ANALYSIS, ...((program.resources.analysis ?? []) as AnalysisSettings[])].slice(0, MAX_ANALYSES).map((wanted) => {
    const settings = { ...wanted, bands: Math.max(12, Math.round(wanted.bands)), hop: Math.min(wanted.hop, wanted.windowSize) }
    return {
      hop: settings.hop,
      fed: 0,
      analyzer: new Analyzer({ ...settings, agc: source.agc, gate: source.gate, sampleRate }),
      textures: new AudioTextures(settings.bands, sampleRate),
      features: null as Features | null,
      pending: { onset: false, beat: false },
    }
  })
}

/** Every hop up to `time`; features as AudioService.takeFeatures gives them (pulses since last call kept), and hop count for timing */
export function feedSlots(slots: Slot[], track: Float32Array, time: number, sampleRate = SAMPLE_RATE): { analyses: (Features | null)[]; hops: number } {
  let hops = 0
  for (const slot of slots) {
    for (; slot.fed + slot.hop <= time * sampleRate; slot.fed += slot.hop) {
      const hop = track.subarray(slot.fed, slot.fed + slot.hop)
      slot.features = slot.analyzer.process(hop)
      slot.textures.push(hop, slot.features)
      slot.pending.onset ||= slot.features.onset
      slot.pending.beat ||= slot.features.beat
      hops++
    }
  }
  const analyses = slots.map((slot) => slot.features && { ...slot.features, ...slot.pending })
  for (const slot of slots) slot.pending = { onset: false, beat: false }
  return { analyses, hops }
}

/** Slot 0's iAudioBands per frame: usermod has one analysis and fft() reads the nearest band, so a band = spectrum at its center */
export function readUsermodBands(frames: number, track = synthesizeTrack()): number[][] {
  const [slot] = openSlots({ resources: {} })
  return Array.from({ length: frames }, (_, frame) => {
    feedSlots([slot], track, frame / FPS)
    return Array.from({ length: 16 }, (_, band) => slot.textures.spectrum[Math.floor(((band + 0.5) / 16) * AUDIO_BINS)] / 255)
  })
}

/** Per frame, what a usermod host fills the audio arrays with for a graph that registered `resources` */
export function feedOfflineAudio(frames: number, resources: Record<string, unknown[]>, track = synthesizeTrack()): AudioFrame[] {
  const slots = openSlots({ resources })
  return Array.from({ length: frames }, (_, frame) => {
    const fed = slots[0].fed
    const taken = feedSlots(slots, track, frame / FPS).analyses
    return {
      bands: slots.map((slot) => foldHeaderBands(slot.textures)),
      features: computeAudioFeatures(taken[0], SAMPLE_RATE),
      spectrum: slots.map(({ textures }) => {
        textures.fillBins()
        return Array.from(textures.bins.subarray(0, textures.binCount))
      }),
      samples: track.subarray(fed, slots[0].fed),
    }
  })
}

// Band texture levels folded to the header's 16, loudest band each covers
function foldHeaderBands({ bands, bandCount }: AudioTextures): number[] {
  return Array.from({ length: 16 }, (_, i) => {
    const from = Math.floor((i * bandCount) / 16)
    const to = Math.max(from + 1, Math.floor(((i + 1) * bandCount) / 16))
    return Math.max(...bands.subarray(from, to)) / 255
  })
}
