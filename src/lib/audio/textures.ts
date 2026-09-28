import type { Features } from './dsp'
import { RingRows, SampleRing } from './dsp'

/** Width of the legacy `iAudio` rows: 512 linear FFT bins and 512 waveform samples. */
export const AUDIO_BINS = 512
/** Hops of band history kept for the spectrogram, about 2.7 s at the default hop. */
export const HISTORY_ROWS = 256
/** Bins of the largest FFT window's spectrum, 8192 samples: the width of the rows `bins` is uploaded into. */
export const MAX_SPECTRUM_BINS = 4096
/** Waveform delay line: WAVE_WIDTH x WAVE_ROWS samples, about a third of a second at 48 kHz. */
export const WAVE_WIDTH = 1024
export const WAVE_ROWS = 16

const toByte = (unit: number) => Math.round(Math.min(1, Math.max(0, unit)) * 255)

/**
 * The CPU side of what the shader reads: everything packed as bytes, ready to upload each frame.
 * - `spectrum`: row 0 linear FFT, row 1 waveform (the layout shaders written for `iAudio` expect)
 * - `bands`: row 0 band levels, row 1 the 12 pitch classes
 * - `history`: one row of bands per hop, a ring; `historyHead` is the newest row
 * - `wave`: the recent samples, a ring in row-major order; `waveHead` is the next sample to be written
 * - `bins`: after `fillBins`, the first `binCount` hold the analysis's own linear spectrum as floats, each bin's level as
 *   Band Split reads it; filled only for a program that reads them
 */
export class AudioTextures {
  readonly spectrum = new Uint8Array(AUDIO_BINS * 2).fill(128, AUDIO_BINS)
  readonly bands: Uint8Array
  readonly history: Uint8Array
  readonly wave = new Uint8Array(WAVE_WIDTH * WAVE_ROWS).fill(128)
  readonly bins = new Float32Array(MAX_SPECTRUM_BINS)
  binCount = 0
  private latest: Features | null = null
  historyHead = 0
  waveHead = 0
  private readonly rows: RingRows
  private readonly samples = new SampleRing(WAVE_WIDTH * WAVE_ROWS)

  constructor(readonly bandCount: number, readonly sampleRate = 48000) {
    // the pitch classes share the band texture's width
    if (bandCount < 12) throw new Error('At least 12 bands are needed')
    this.bands = new Uint8Array(bandCount * 2)
    this.history = new Uint8Array(bandCount * HISTORY_ROWS)
    this.rows = new RingRows(bandCount, HISTORY_ROWS)
  }

  /** Fills `bins` from the newest hop's spectrum; the analyzer keeps that spectrum until its next hop. */
  fillBins() {
    const features = this.latest
    if (!features) return
    const { spectrum, gate, gain } = features
    // a monotonic level per bin, so the loudest bin of a range levels as its loudest magnitude does
    this.binCount = spectrum.length
    for (let i = 0; i < spectrum.length; i++) this.bins[i] = gate ? Math.sqrt(Math.min(1, spectrum[i] * gain)) : 0
  }

  /** Call once per hop with that hop's samples and the features computed from it. */
  push(hop: Float32Array, features: Features) {
    const { spectrum, waveform, bands, chroma } = features
    const perBin = spectrum.length / AUDIO_BINS
    for (let i = 0; i < AUDIO_BINS; i++) {
      let peak = 0
      for (let k = 0; k < perBin; k++) peak = Math.max(peak, spectrum[Math.floor(i * perBin) + k])
      this.spectrum[i] = features.gate ? toByte(Math.sqrt(peak * features.gain)) : 0
      this.spectrum[AUDIO_BINS + i] = toByte(waveform[waveform.length - AUDIO_BINS + i] * 0.5 + 0.5)
    }
    this.latest = features
    for (let i = 0; i < this.bandCount; i++) this.bands[i] = toByte(bands[i])
    for (let i = 0; i < 12; i++) this.bands[this.bandCount + i] = toByte(chroma[i])

    this.history.set(this.bands.subarray(0, this.bandCount), this.rows.head * this.bandCount)
    this.rows.push(bands)
    this.historyHead = (this.rows.head - 1 + HISTORY_ROWS) % HISTORY_ROWS

    for (let i = 0; i < hop.length; i++) {
      // 128 is exactly zero, so silence decodes to 0 and not to half a step above it
      this.wave[this.waveHead] = 128 + Math.round(Math.min(1, Math.max(-1, hop[i])) * 127)
      this.waveHead = (this.waveHead + 1) % this.wave.length
    }
    this.samples.push(hop)
  }

  /** The newest samples, for control-rate readers and previews. */
  recent(out: Float32Array, delay = 0): Float32Array {
    return this.samples.read(out, delay)
  }
}
