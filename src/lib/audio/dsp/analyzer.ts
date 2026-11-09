import { Filterbank, type BandConfig } from './bands'
import { Fft, createWindow, type WindowType } from './fft'
import { Agc, SilenceGate, peak, rms, type AgcConfig } from './level'
import { SampleRing } from './ring'
import { OnsetDetector, centroid, chroma, flatness } from './spectral'
import { TempoTracker } from './tempo'

export interface AnalyzerConfig extends BandConfig {
  sampleRate: number
  /** Samples per FFT frame, a power of two. Larger resolves bass better and reacts slower. */
  windowSize: number
  /** Samples between frames. `windowSize / hop` is the overlap. */
  hop: number
  window: WindowType
  agc: AgcConfig
  gate: { thresholdDb: number; hold: number }
}

export const DEFAULT_ANALYZER: Omit<AnalyzerConfig, 'sampleRate'> = {
  windowSize: 2048,
  hop: 512,
  window: 'hann',
  bands: 64,
  scale: 'mel',
  fmin: 40,
  fmax: 16000,
  agc: { release: 8, floorDb: -50 },
  gate: { thresholdDb: -55, hold: 0.3 },
}

export interface Features {
  /** Band levels after gain control, 0 to 1. */
  bands: Float32Array
  /** Linear spectrum, amplitude per FFT bin with a full-scale sine at 1. */
  spectrum: Float32Array
  /** The samples of this frame, -1 to 1. */
  waveform: Float32Array
  /** 12 pitch classes from C, strongest at 1. */
  chroma: Float32Array
  /** Loudness after gain control, 0 to 1. */
  level: number
  /** The factor gain control currently applies to amplitudes. */
  gain: number
  rms: number
  peak: number
  /** False while the input is silent; everything above is zeroed then. */
  gate: boolean
  flux: number
  onset: boolean
  bpm: number
  beatPhase: number
  beat: boolean
  beatConfidence: number
  /** Brightness of the mix, 0 (bass) to 1 (treble). */
  centroid: number
  /** 0 for a pure tone, toward 1 for noise. */
  flatness: number
}

/** Turns hops of mono samples into features. No Web Audio in here, so it runs anywhere. */
export class Analyzer {
  readonly hopRate: number
  readonly filterbank: Filterbank
  private readonly fft: Fft
  private readonly window: Float32Array
  private readonly windowGain: number
  private readonly recent: SampleRing
  private readonly frame: Float32Array
  private readonly windowed: Float32Array
  private readonly rawBands: Float32Array
  private readonly agc: Agc
  private readonly gate: SilenceGate
  private readonly onsets: OnsetDetector
  private readonly tempo: TempoTracker
  private readonly features: Features

  constructor(readonly config: AnalyzerConfig) {
    const { sampleRate, windowSize, hop } = config
    this.hopRate = sampleRate / hop
    this.fft = new Fft(windowSize)
    this.window = createWindow(config.window, windowSize)
    this.windowGain = 2 / this.window.reduce((a, b) => a + b, 0)
    this.filterbank = new Filterbank(config, sampleRate, windowSize)
    this.recent = new SampleRing(windowSize)
    this.frame = new Float32Array(windowSize)
    this.windowed = new Float32Array(windowSize)
    this.rawBands = new Float32Array(config.bands)
    this.agc = new Agc(config.agc)
    this.gate = new SilenceGate(config.gate.thresholdDb, config.gate.hold)
    this.onsets = new OnsetDetector(this.hopRate)
    this.tempo = new TempoTracker(this.hopRate)
    this.features = {
      bands: new Float32Array(config.bands),
      spectrum: new Float32Array(windowSize / 2),
      waveform: this.frame,
      chroma: new Float32Array(12),
      level: 0,
      gain: 1,
      rms: 0,
      peak: 0,
      gate: false,
      flux: 0,
      onset: false,
      bpm: 120,
      beatPhase: 0,
      beat: false,
      beatConfidence: 0,
      centroid: 0,
      flatness: 0,
    }
  }

  /** Feed exactly `config.hop` new samples. The returned object is reused; copy what you keep. */
  process(hop: Float32Array): Features {
    const f = this.features
    const dt = 1 / this.hopRate
    this.recent.push(hop)
    this.recent.read(this.frame)
    for (let i = 0; i < this.frame.length; i++) this.windowed[i] = this.frame[i] * this.window[i]
    this.fft.magnitudes(this.windowed, this.windowGain, f.spectrum)
    this.filterbank.apply(f.spectrum, this.rawBands)

    f.rms = rms(hop)
    f.peak = peak(hop)
    f.gate = this.gate.open(f.rms, dt)
    // gain follows the loudest band, so the spectrum fills its range whatever the input volume
    const gain = this.agc.gain(Math.max(...this.rawBands), dt)
    f.gain = gain
    // square root: halving the amplitude should dim a band, not switch it off
    for (let i = 0; i < f.bands.length; i++) f.bands[i] = f.gate ? Math.sqrt(Math.min(1, this.rawBands[i] * gain)) : 0
    f.level = f.gate ? Math.sqrt(Math.min(1, f.rms * Math.SQRT2 * gain)) : 0

    const { flux, onset } = this.onsets.process(f.bands)
    f.flux = flux
    f.onset = onset
    const beat = this.tempo.process(flux)
    f.bpm = beat.bpm
    f.beatPhase = beat.phase
    f.beat = beat.beat
    f.beatConfidence = beat.confidence

    // above 5 kHz there is little pitch left to sort into classes
    chroma(f.spectrum, this.config.sampleRate, this.config.windowSize, this.config.fmin, Math.min(this.config.fmax, 5000), f.chroma)
    f.centroid = f.gate ? centroid(f.spectrum, this.config.sampleRate, this.config.windowSize) : 0
    f.flatness = f.gate ? flatness(f.spectrum) : 0
    return f
  }
}
