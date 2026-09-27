import { rangePeak, type Features } from './dsp'

/** Named ranges of a mix, in Hz; each follows the loudest partial inside it. */
export const RANGES = { sub: [20, 60], kick: [60, 150], lowMid: [150, 500], vocal: [500, 2000], presence: [2000, 6000], air: [6000, 16000] } as const

export const rangeLevel = (f: Features, sampleRate: number, low: number, high: number) =>
  (f.gate ? Math.sqrt(Math.min(1, rangePeak(f.spectrum, sampleRate, f.spectrum.length * 2, low, high) * f.gain)) : 0)

const range = ([low, high]: readonly [number, number]) => (f: Features, sampleRate: number) => rangeLevel(f, sampleRate, low, high)

// the Audio node's outputs, in the order a host uploads them
const FEATURES = {
  level: (f: Features) => f.level,
  rms: (f: Features) => f.rms,
  peak: (f: Features) => f.peak,
  gate: (f: Features) => Number(f.gate),
  onset: (f: Features) => Number(f.onset),
  beat: (f: Features) => Number(f.beat),
  beatPhase: (f: Features) => f.beatPhase,
  bpm: (f: Features) => f.bpm,
  centroid: (f: Features) => f.centroid,
  flatness: (f: Features) => f.flatness,
  sub: range(RANGES.sub),
  kick: range(RANGES.kick),
  lowMid: range(RANGES.lowMid),
  vocal: range(RANGES.vocal),
  presence: range(RANGES.presence),
  air: range(RANGES.air),
}

/** The Audio node's outputs in the order `iAudioFeatures` holds them, four to a vector. */
export const AUDIO_FEATURES = Object.keys(FEATURES) as (keyof typeof FEATURES)[]

const READS = Object.values(FEATURES)

/**
 * `iAudioFeatures` for one frame, written into `out`: `f` is the analysis with the pulses raised since the previous
 * frame, as `AudioService.takeFeatures` gives it; without one the Audio node reads silence at 120 BPM.
 */
export function audioFeatures(f: Features | null, sampleRate: number, out = new Float32Array(READS.length)): Float32Array<ArrayBuffer> {
  for (let i = 0; i < READS.length; i++) out[i] = f ? READS[i](f, sampleRate) : 0
  if (!f) out[AUDIO_FEATURES.indexOf('bpm')] = 120
  return out
}
