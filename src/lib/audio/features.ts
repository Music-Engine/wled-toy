import { rangePeak, type Features } from './dsp'

/**
 * `iAudioFeatures` for one frame into `out`; `analysis` w/ pulses raised since prev frame, as `AudioService.takeFeatures`
 * gives it; none = silence at 120 BPM
 */
export function computeAudioFeatures(analysis: Features | null, sampleRate: number, out = new Float32Array(READS.length)): Float32Array<ArrayBuffer> {
  for (let i = 0; i < READS.length; i++) out[i] = analysis ? READS[i](analysis, sampleRate) : 0
  if (!analysis) out[AUDIO_FEATURES.indexOf('bpm')] = 120
  return out
}

// Upload order
const FEATURES = {
  level: (analysis: Features) => analysis.level,
  rms: (analysis: Features) => analysis.rms,
  peak: (analysis: Features) => analysis.peak,
  gate: (analysis: Features) => Number(analysis.gate),
  onset: (analysis: Features) => Number(analysis.onset),
  beat: (analysis: Features) => Number(analysis.beat),
  beatPhase: (analysis: Features) => analysis.beatPhase,
  bpm: (analysis: Features) => analysis.bpm,
  centroid: (analysis: Features) => analysis.centroid,
  flatness: (analysis: Features) => analysis.flatness,
  sub: toRangeLevelReader(20, 60),
  kick: toRangeLevelReader(60, 150),
  lowMid: toRangeLevelReader(150, 500),
  vocal: toRangeLevelReader(500, 2000),
  presence: toRangeLevelReader(2000, 6000),
  air: toRangeLevelReader(6000, 16000),
}

/** Audio node outputs in `iAudioFeatures` order, four to a vector */
export const AUDIO_FEATURES = Object.keys(FEATURES) as (keyof typeof FEATURES)[]

const READS = Object.values(FEATURES)

/** Level of a named range of the mix, in Hz, following its loudest partial */
function toRangeLevelReader(low: number, high: number) {
  return (analysis: Features, sampleRate: number) =>
    analysis.gate ? Math.sqrt(Math.min(1, rangePeak(analysis.spectrum, sampleRate, analysis.spectrum.length * 2, low, high) * analysis.gain)) : 0
}
