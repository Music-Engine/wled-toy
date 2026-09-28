import { Analyzer, type Features } from './dsp'
import { AudioTextures } from './textures'
import { DEFAULT_ANALYSIS, MAX_ANALYSES, type AnalysisSettings, type AudioSettings } from './settings'
import { sameJson } from '@/lib/util/json'

interface Analysis {
  settings: AnalysisSettings
  analyzer: Analyzer
  textures: AudioTextures
  features: Features | null
  /** Samples gathered toward this analysis' next hop. */
  hop: Float32Array
  filled: number
  /** One-hop pulses raised since the control step last took them. */
  pending: { onset: boolean; beat: boolean }
}

/** The analyses that run on the live source, each cutting the worklet's blocks into its own hops. */
export class AnalysisSlots {
  /** Slot 0 is the default analysis; an FFT node with other settings adds a slot. */
  private analyses: Analysis[] = []
  private wanted: AnalysisSettings[] = [DEFAULT_ANALYSIS]
  private idleTextures = new AudioTextures(DEFAULT_ANALYSIS.bands)

  /** Features of the default analysis, or null until audio has run once. The object is reused hop to hop. */
  get features(): Features | null {
    return this.analyses[0]?.features ?? null
  }

  /** Textures of the default analysis; previews and hand-written shaders read these. */
  get textures(): AudioTextures {
    return this.analyses[0]?.textures ?? this.idleTextures
  }

  /** Per slot: what the shader and the control nodes read. Empty until audio has run. */
  get slots(): { textures: AudioTextures; features: Features | null }[] {
    return this.analyses
  }

  /** The block the worklet delivers: the smallest hop. Hops are powers of two, so every analysis fills in whole blocks. */
  get block(): number {
    return Math.min(...this.wanted.map((a) => a.hop))
  }

  /**
   * Per slot, the newest features with `onset` and `beat` true if any hop raised them since the previous call. Both are
   * up for one 11 ms hop, and the control step runs slower than that, so reading `features` directly would miss most.
   */
  takeFeatures(): (Features | null)[] {
    return this.analyses.map((analysis) => {
      if (!analysis.features) return null
      const features = { ...analysis.features, ...analysis.pending }
      analysis.pending = { onset: false, beat: false }
      return features
    })
  }

  /** The analyses besides the default one, in slot order; extra ones beyond the limit are ignored. False when nothing changed. */
  want(extra: AnalysisSettings[]): boolean {
    const wanted = [DEFAULT_ANALYSIS, ...extra]
      .slice(0, MAX_ANALYSES)
      .map((a) => ({ ...a, bands: Math.max(12, Math.round(a.bands)), hop: Math.min(a.hop, a.windowSize) }))
    if (sameJson(wanted, this.wanted)) return false
    this.wanted = wanted
    return true
  }

  /** Builds the wanted analyses for these levels and sample rate; one whose settings did not change keeps its history and its tempo lock. */
  rebuild({ agc, gate }: Pick<AudioSettings, 'agc' | 'gate'>, sampleRate: number) {
    const kept = this.analyses
    this.analyses = this.wanted.map((settings) => {
      const same = kept.find(
        (a) =>
          sameJson(a.settings, settings) &&
          sameJson([a.analyzer.config.agc, a.analyzer.config.gate], [agc, gate]) &&
          a.analyzer.config.sampleRate === sampleRate,
      )
      return (
        same ?? {
          settings,
          analyzer: new Analyzer({ ...settings, agc, gate, sampleRate }),
          textures: new AudioTextures(settings.bands, sampleRate),
          features: null,
          hop: new Float32Array(settings.hop),
          filled: 0,
          pending: { onset: false, beat: false },
        }
      )
    })
  }

  /** Adds a worklet block to every analysis and analyzes each hop it completes. */
  feed(data: Float32Array) {
    for (const analysis of this.analyses) {
      for (let offset = 0; offset < data.length; ) {
        const take = Math.min(data.length - offset, analysis.hop.length - analysis.filled)
        analysis.hop.set(data.subarray(offset, offset + take), analysis.filled)
        analysis.filled += take
        offset += take
        if (analysis.filled < analysis.hop.length) continue
        analysis.filled = 0
        analysis.features = analysis.analyzer.process(analysis.hop)
        analysis.textures.push(analysis.hop, analysis.features)
        analysis.pending.onset ||= analysis.features.onset
        analysis.pending.beat ||= analysis.features.beat
      }
    }
  }
}
