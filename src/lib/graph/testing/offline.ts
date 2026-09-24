// The offline side of the engine's LED tick, shared by the demo-graph test and the bench harness: the synthetic
// track both run on, and the analysis slots AudioService would have opened for a compiled graph.
import { Analyzer, type Features } from '@/lib/audio/dsp'
import { DEFAULT_ANALYSIS, DEFAULT_AUDIO, MAX_ANALYSES, type AnalysisSettings, type AudioSourceRequest } from '@/lib/audio/service'
import { AudioTextures } from '@/lib/audio/textures'
import type { FramePlan } from '@/lib/graph/compile/js/frame'

export const SAMPLE_RATE = 48000
export const FPS = 30
export const SECONDS = 10
export const BEAT = 0.5
export const BREAKDOWN = [6, 8]

export const section = (t: number) => (t < BREAKDOWN[0] ? 'groove' : t < BREAKDOWN[1] ? 'breakdown' : 'drop')

/**
 * 120 BPM, one chord per 2 s bar: three bars of groove, one bar of breakdown (pad and lead only), one bar of drop.
 * Parts sit in separate ranges of the Audio node so each output follows one instrument: kick in sub and kick, bass in
 * lowMid, pad and lead in vocal, snare and hats in presence and air.
 */
export function synthTrack(seconds = SECONDS): Float32Array {
  const out = new Float32Array(seconds * SAMPLE_RATE)
  // Am, C, Em, Dm (breakdown), Am (drop)
  const chords = [[220, 261.63, 329.63], [261.63, 329.63, 392], [329.63, 392, 493.88], [293.66, 349.23, 440], [220, 261.63, 329.63]]
  const tone = (hz: number, at: number) => Math.sin(2 * Math.PI * hz * at)
  let seed = 1
  let lastNoise = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / SAMPLE_RATE
    seed = (seed * 1664525 + 1013904223) >>> 0
    const noise = seed / 2 ** 31 - 1
    const hiss = (noise - lastNoise) / 2
    lastNoise = noise

    const part = section(t % SECONDS)
    const chord = chords[Math.floor((t % SECONDS) / 2)]
    const sinceBeat = t % BEAT
    const sinceEighth = t % (BEAT / 2)
    const eighth = Math.floor(t / (BEAT / 2))

    const kick = 0.8 * Math.sin(2 * Math.PI * (45 * sinceBeat + 75 * 0.05 * (1 - Math.exp(-sinceBeat / 0.05)))) * Math.exp(-sinceBeat / 0.15)
    const snare = Math.floor(t / BEAT) % 2 === 1 ? (0.6 * noise + 0.2 * tone(190, sinceBeat)) * Math.exp(-sinceBeat / 0.07) : 0
    const hat = eighth % 2 === 1 || part === 'drop' ? 0.6 * hiss * Math.exp(-sinceEighth / (part === 'drop' ? 0.05 : 0.025)) : 0
    const bass = eighth % 2 === 1 ? 0.25 * tone(chord[0], sinceEighth) * Math.exp(-sinceEighth / 0.15) : 0
    const pad = chord.reduce((sum, hz) => sum + tone(hz * 2, t % 2) + 0.3 * tone(hz * 4, t % 2), 0) * 0.03
    const lead = (part === 'drop' ? 0.2 : 0.12) * tone(chord[[0, 1, 2, 1][eighth % 4]] * 4, sinceEighth) * Math.exp(-sinceEighth / 0.12)

    out[i] = part === 'breakdown' ? 0.25 * (pad + lead) : 0.6 * (kick + snare + hat + bass + pad + lead)
  }
  return out
}

export interface Slot {
  hop: number
  fed: number
  analyzer: Analyzer
  textures: AudioTextures
  features: Features | null
  pending: { onset: boolean; beat: boolean }
}

/** As AudioService does it: slot 0 is the default analysis, FFT nodes add slots, the Audio Source sets gain and gate. */
export function openSlots(plan: FramePlan, sampleRate = SAMPLE_RATE): Slot[] {
  const [source = DEFAULT_AUDIO] = (plan.resources.audioSource ?? []) as AudioSourceRequest[]
  return [DEFAULT_ANALYSIS, ...(plan.resources.analysis ?? []) as AnalysisSettings[]].slice(0, MAX_ANALYSES).map((wanted) => {
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

/**
 * Analyzes every hop up to `time` and returns what the frame bodies see, as AudioService.takeFeatures does it: a
 * pulse raised by any hop since the last call reaches them. Returns the number of hops analyzed for the caller's timing.
 */
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
