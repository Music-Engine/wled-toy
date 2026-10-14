export type BandScale = 'log' | 'mel'

export interface BandConfig {
  bands: number
  scale: BandScale
  /** Lowest and highest frequency covered, in Hz. */
  fmin: number
  fmax: number
}

const toMel = (hz: number) => 2595 * Math.log10(1 + hz / 700)
const fromMel = (mel: number) => 700 * (10 ** (mel / 2595) - 1)

/** Band edges in Hz: `bands + 2` points, each band a triangle from edge i to i + 2 peaking at i + 1. */
export function bandEdges({ bands, scale, fmin, fmax }: BandConfig): number[] {
  const [lo, hi] = scale === 'mel' ? [toMel(fmin), toMel(fmax)] : [Math.log2(fmin), Math.log2(fmax)]
  return Array.from({ length: bands + 2 }, (_, i) => {
    const x = lo + ((hi - lo) * i) / (bands + 1)
    return scale === 'mel' ? fromMel(x) : 2 ** x
  })
}

/**
 * Triangular filters over linear FFT bins. Linear bins give bass two or three bins and treble hundreds;
 * log or mel spacing gives every octave a similar share, which is what reads well on a strip.
 */
export class Filterbank {
  readonly centers: number[]
  private readonly filters: { start: number; weights: Float32Array }[]

  constructor(
    readonly config: BandConfig,
    sampleRate: number,
    fftSize: number,
  ) {
    const edges = bandEdges(config)
    const hzPerBin = sampleRate / fftSize
    this.centers = edges.slice(1, -1)
    this.filters = this.centers.map((center, i) => {
      const [low, high] = [edges[i], edges[i + 2]]
      const start = Math.max(1, Math.floor(low / hzPerBin))
      const end = Math.min(fftSize / 2 - 1, Math.ceil(high / hzPerBin))
      const weights = Float32Array.from({ length: Math.max(1, end - start + 1) }, (_, k) => {
        const hz = (start + k) * hzPerBin
        return Math.max(0, hz <= center ? (hz - low) / (center - low) : (high - hz) / (high - center))
      })
      // a band narrower than one bin would otherwise be all zeros; give it the bin nearest its center
      if (!weights.some((w) => w > 0)) weights[Math.min(weights.length - 1, Math.max(0, Math.round(center / hzPerBin) - start))] = 1
      return { start, weights }
    })
  }

  /** Peak weighted amplitude per band: a lone sine reads the same in a wide band as in a narrow one. */
  apply(magnitudes: Float32Array, out: Float32Array): Float32Array {
    this.filters.forEach(({ start, weights }, band) => {
      let peak = 0
      for (let k = 0; k < weights.length; k++) peak = Math.max(peak, magnitudes[start + k] * weights[k])
      out[band] = peak
    })
    return out
  }

  /** Index of the band whose center is nearest `hz`. */
  bandAt(hz: number): number {
    return this.centers.reduce((best, center, i) => (Math.abs(Math.log(center / hz)) < Math.abs(Math.log(this.centers[best] / hz)) ? i : best), 0)
  }
}
