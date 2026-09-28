/**
 * Energy per pitch class, C first, normalized so the strongest is 1. Only bins from `lowHz` to `highHz` count, so an
 * analysis can leave the kick out. A bin goes whole to its nearest semitone: below about 17 bin widths that is more than
 * one semitone wide, and a bigger FFT window is the only cure.
 */
export function chroma(magnitudes: Float32Array, sampleRate: number, fftSize: number, lowHz: number, highHz: number, out: Float32Array): Float32Array {
  out.fill(0)
  const hzPerBin = sampleRate / fftSize
  for (let bin = Math.max(1, Math.ceil(lowHz / hzPerBin)); bin < magnitudes.length && bin * hzPerBin < highHz; bin++) {
    const midi = 69 + 12 * Math.log2((bin * hzPerBin) / 440)
    out[((Math.round(midi) % 12) + 12) % 12] += magnitudes[bin] * magnitudes[bin]
  }
  const max = Math.max(...out)
  if (max > 0) for (let i = 0; i < 12; i++) out[i] = Math.sqrt(out[i] / max)
  return out
}

/**
 * Where the spectrum's weight sits, 0 (all bass) to 1 (all treble), on a log frequency axis from 50 Hz
 * to Nyquist so that it moves usefully for music rather than hugging zero. Reads as brightness.
 */
export function centroid(magnitudes: Float32Array, sampleRate: number, fftSize: number): number {
  const hzPerBin = sampleRate / fftSize
  let weighted = 0
  let total = 0
  for (let bin = 1; bin < magnitudes.length; bin++) {
    weighted += Math.log2(bin * hzPerBin) * magnitudes[bin]
    total += magnitudes[bin]
  }
  if (total < 1e-9) return 0
  const [lo, hi] = [Math.log2(50), Math.log2(sampleRate / 2)]
  return Math.min(1, Math.max(0, (weighted / total - lo) / (hi - lo)))
}

/** Loudest bin between two frequencies, as an amplitude. For following one instrument's range, e.g. 60 to 150 Hz for a kick. */
export function rangePeak(magnitudes: Float32Array, sampleRate: number, fftSize: number, lowHz: number, highHz: number): number {
  const hzPerBin = sampleRate / fftSize
  const first = Math.max(1, Math.floor(Math.min(lowHz, highHz) / hzPerBin))
  const last = Math.min(magnitudes.length - 1, Math.ceil(Math.max(lowHz, highHz) / hzPerBin))
  let peak = 0
  for (let bin = first; bin <= last; bin++) peak = Math.max(peak, magnitudes[bin])
  return peak
}

/** Geometric over arithmetic mean of the power spectrum: near 0 for a tone, toward 1 for noise. */
export function flatness(magnitudes: Float32Array): number {
  let logSum = 0
  let sum = 0
  const n = magnitudes.length - 1
  for (let bin = 1; bin < magnitudes.length; bin++) {
    const power = magnitudes[bin] * magnitudes[bin] + 1e-12
    logSum += Math.log(power)
    sum += power
  }
  return Math.exp(logSum / n) / (sum / n)
}

/**
 * Spectral flux: how much energy appeared since the last frame, summed over bands. An onset is a flux
 * peak that clears the recent mean by `sensitivity` standard deviations.
 */
export class OnsetDetector {
  private previous: Float32Array | null = null
  private readonly recent: Float32Array
  private head = 0
  private lastFlux = 0
  private rising = false

  constructor(
    hopRate: number,
    private readonly sensitivity = 1.5,
  ) {
    this.recent = new Float32Array(Math.max(8, Math.round(hopRate)))
  }

  process(bands: Float32Array): { flux: number; onset: boolean } {
    let flux = 0
    if (this.previous) for (let i = 0; i < bands.length; i++) flux += Math.max(0, bands[i] - this.previous[i])
    this.previous = Float32Array.from(bands)

    const mean = this.recent.reduce((a, b) => a + b, 0) / this.recent.length
    const deviation = Math.sqrt(this.recent.reduce((a, b) => a + (b - mean) ** 2, 0) / this.recent.length)
    this.recent[this.head] = flux
    this.head = (this.head + 1) % this.recent.length

    // report the onset on the frame after the peak, when the flux has turned down
    const wasPeak = this.rising && flux < this.lastFlux && this.lastFlux > mean + this.sensitivity * deviation + 1e-4
    this.rising = flux > this.lastFlux
    this.lastFlux = flux
    return { flux, onset: wasPeak }
  }
}
