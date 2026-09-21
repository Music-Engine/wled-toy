export type WindowType = 'hann' | 'hamming' | 'blackman'

export function createWindow(type: WindowType, size: number): Float32Array {
  const w = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    const x = (2 * Math.PI * i) / (size - 1)
    w[i] = type === 'hann' ? 0.5 - 0.5 * Math.cos(x)
      : type === 'hamming' ? 0.54 - 0.46 * Math.cos(x)
        : 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x)
  }
  return w
}

/** In-place radix-2 FFT of a fixed power-of-two size, with the tables computed once. */
export class Fft {
  readonly bins: number
  private readonly cos: Float32Array
  private readonly sin: Float32Array
  private readonly reversed: Uint32Array
  private readonly re: Float32Array
  private readonly im: Float32Array

  constructor(readonly size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${size}`)
    this.bins = size / 2
    this.cos = Float32Array.from({ length: size / 2 }, (_, i) => Math.cos((2 * Math.PI * i) / size))
    this.sin = Float32Array.from({ length: size / 2 }, (_, i) => Math.sin((2 * Math.PI * i) / size))
    const bits = Math.log2(size)
    this.reversed = Uint32Array.from({ length: size }, (_, i) => {
      let r = 0
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
      return r
    })
    this.re = new Float32Array(size)
    this.im = new Float32Array(size)
  }

  /**
   * Amplitude per bin of `windowed` (already multiplied by its window), scaled by `gain` so that a
   * full-scale sine reads 1 when gain is 2 / sum(window).
   */
  magnitudes(windowed: Float32Array, gain: number, out: Float32Array): Float32Array {
    const { size, re, im, cos, sin, reversed } = this
    for (let i = 0; i < size; i++) {
      re[reversed[i]] = windowed[i]
      im[i] = 0
    }
    for (let half = 1; half < size; half *= 2) {
      const stride = size / (half * 2)
      for (let start = 0; start < size; start += half * 2) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * stride]
          const wi = -sin[k * stride]
          const a = start + k
          const b = a + half
          const tr = re[b] * wr - im[b] * wi
          const ti = re[b] * wi + im[b] * wr
          re[b] = re[a] - tr
          im[b] = im[a] - ti
          re[a] += tr
          im[a] += ti
        }
      }
    }
    for (let i = 0; i < this.bins; i++) out[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * gain
    return out
  }
}
