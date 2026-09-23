import { reactive } from 'vue'
import { log } from '@/lib/app/logs'
import { isMac, isTauri } from '@/lib/app/platform'
import { Analyzer, DEFAULT_ANALYZER, type AnalyzerConfig, type Features } from './dsp'
import { AudioTextures } from './textures'

export type AudioSourceKind = 'file' | 'device' | 'loopback'
export type AudioChannel = 'mono' | 'left' | 'right'

/** Where the audio comes from and how its level is tamed. One of these is live at a time. */
export interface AudioSettings extends Pick<AnalyzerConfig, 'agc' | 'gate'> {
  source: AudioSourceKind
  /** `deviceId` from enumerateDevices, or '' for the system default. */
  deviceId: string
  channel: AudioChannel
}

/** What a graph's Audio Source asks for. Which device is captured is not part of it: devices differ per machine. */
export type AudioSourceRequest = Omit<AudioSettings, 'deviceId'>

/** How one FFT looks at the live source. Several can run side by side, e.g. a fast coarse one and a slow fine one. */
export type AnalysisSettings = Omit<AnalyzerConfig, 'sampleRate' | 'agc' | 'gate'>

const { agc, gate, ...DEFAULT_FFT } = DEFAULT_ANALYZER
export const DEFAULT_ANALYSIS: AnalysisSettings = DEFAULT_FFT
export const DEFAULT_AUDIO: AudioSettings = { agc, gate, source: 'file', deviceId: '', channel: 'mono' }

/** Why system audio cannot be captured here, or null when it can: WKWebView, the webview of the macOS desktop app, delivers no audio through getDisplayMedia. */
export const systemAudioBlocked = (): string | null => (isTauri() && isMac()
  ? 'System audio capture is not available in the desktop app yet. Route audio through a loopback device such as BlackHole and pick it as the capture device.'
  : null)

/** The shader has this many sets of band and history textures. Slot 0 is always the default analysis. */
export const MAX_ANALYSES = 4

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

/**
 * One audio input for the whole app: captures from a file, an input device or another tab / the system
 * (loopback), cuts it into hops in a worklet, analyzes each hop and keeps the textures the shader reads.
 */
export class AudioService {
  readonly state = reactive({
    playing: false,
    sampleRate: 0,
    settings: structuredClone(DEFAULT_AUDIO) as AudioSettings,
    devices: [] as { deviceId: string; label: string }[],
    error: null as string | null,
    /** The browser refused the share picker because no click was behind the request; the UI offers a button that calls `shareSystemAudio()`. */
    sharePrompt: false,
    /** Name of the song the file source plays. */
    fileName: 'Built-in track',
  })

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

  private context: AudioContext | null = null
  private worklet: AudioWorkletNode | null = null
  private input: AudioNode | null = null
  private stream: MediaStream | null = null
  private element: HTMLAudioElement | null = null
  private elementSource: MediaElementAudioSourceNode | null = null
  private objectUrl: string | null = null

  constructor(private readonly fileUrl: string) {}

  async toggle() {
    if (this.state.playing) this.pause()
    else await this.start()
  }

  /** Starts (or resumes) the configured source. Must be called from a user gesture the first time. */
  async start() {
    this.state.error = null
    this.state.sharePrompt = false
    try {
      this.context ??= await this.createContext()
      await this.context.resume()
      if (!this.input) await this.connect(this.state.settings.source)
      await this.element?.play()
      this.state.playing = true
      log(`Audio running (${this.state.settings.source}, ${this.context.sampleRate} Hz)`)
    } catch (e) {
      this.fail(e)
    }
  }

  pause() {
    this.element?.pause()
    void this.context?.suspend()
    this.state.playing = false
    log('Audio paused')
  }

  /** Applies changed settings: a new source reconnects, new analysis parameters rebuild the analyzer, a channel change is live. */
  async configure(patch: Partial<AudioSettings>) {
    const before = this.state.settings
    const next = { ...before, ...patch }
    this.state.settings = next
    const sourceChanged = next.source !== before.source || next.deviceId !== before.deviceId
    if (sourceChanged) {
      this.state.error = null
      this.state.sharePrompt = false
    }
    if (!this.context) return

    const levelsChanged = JSON.stringify([next.agc, next.gate]) !== JSON.stringify([before.agc, before.gate])
    if (next.channel !== before.channel) this.worklet?.port.postMessage({ channel: next.channel })
    if (levelsChanged) this.rebuildAnalysis()
    if (sourceChanged) {
      try {
        await this.connect(next.source)
        if (this.state.playing) await this.element?.play()
      } catch (e) {
        // keep what was working: a refused permission must not leave the app without audio
        this.state.settings = { ...next, source: before.source, deviceId: before.deviceId }
        this.fail(e)
        if (!this.input) await this.connect(before.source).catch(() => undefined)
      }
    }
  }

  /** For the click handler of a real button: the share picker is asked for before anything is awaited, while the click still counts as the user's gesture. */
  async shareSystemAudio() {
    this.state.error = null
    this.state.sharePrompt = false
    let stream: MediaStream | undefined
    try {
      stream = await this.capture('loopback', true)
      this.context ??= await this.createContext()
      await this.context.resume()
      this.state.settings = { ...this.state.settings, source: 'loopback' }
      await this.connect('loopback', stream)
      this.state.playing = true
      log(`Audio running (loopback, ${this.context.sampleRate} Hz)`)
    } catch (e) {
      if (this.stream !== stream) stream?.getTracks().forEach((track) => track.stop())
      this.fail(e)
    }
  }

  /** Plays this file as the file source from now on; null goes back to the built-in track. */
  async setFile(file: { blob: Blob; name: string } | null) {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl)
    this.objectUrl = file ? URL.createObjectURL(file.blob) : null
    this.state.fileName = file?.name ?? 'Built-in track'
    // before the first start there is no element yet; it picks the URL up when it is created
    if (!this.element) return
    this.element.src = this.objectUrl ?? this.fileUrl
    if (this.state.playing && this.state.settings.source === 'file') await this.element.play().catch((e) => this.fail(e))
  }

  /** The analyses the running graph reads besides the default one, in slot order. Extra ones beyond the limit are ignored. */
  setAnalyses(extra: AnalysisSettings[]) {
    const wanted = [DEFAULT_ANALYSIS, ...extra].slice(0, MAX_ANALYSES).map((a) => ({ ...a, bands: Math.max(12, Math.round(a.bands)), hop: Math.min(a.hop, a.windowSize) }))
    if (JSON.stringify(wanted) === JSON.stringify(this.wanted)) return
    this.wanted = wanted
    if (this.context) this.rebuildAnalysis()
  }

  async refreshDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices()
    this.state.devices = devices.filter((d) => d.kind === 'audioinput').map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Input ${i + 1}` }))
  }

  dispose() {
    this.disconnect()
    void this.context?.close()
    this.context = null
  }

  private async createContext(): Promise<AudioContext> {
    const context = new AudioContext()
    await context.audioWorklet.addModule(new URL('./hop-processor.js', import.meta.url))
    this.state.sampleRate = context.sampleRate
    return context
  }

  private rebuildAnalysis() {
    const context = this.context!
    const { agc, gate, channel } = this.state.settings
    // an analysis whose settings did not change keeps its history and its tempo lock
    const kept = this.analyses
    const levels = JSON.stringify([agc, gate])
    this.analyses = this.wanted.map((settings) => {
      const same = kept.find((a) => JSON.stringify(a.settings) === JSON.stringify(settings) && JSON.stringify([a.analyzer.config.agc, a.analyzer.config.gate]) === levels
        && a.analyzer.config.sampleRate === context.sampleRate)
      return same ?? {
        settings,
        analyzer: new Analyzer({ ...settings, agc, gate, sampleRate: context.sampleRate }),
        textures: new AudioTextures(settings.bands, context.sampleRate),
        features: null,
        hop: new Float32Array(settings.hop),
        filled: 0,
        pending: { onset: false, beat: false },
      }
    })

    // the worklet delivers blocks of the smallest hop; hops are powers of two, so every analysis fills in whole blocks
    const block = Math.min(...this.wanted.map((a) => a.hop))
    this.worklet?.disconnect()
    const worklet = new AudioWorkletNode(context, 'hop-processor', { numberOfOutputs: 0, processorOptions: { hop: block, channel } })
    worklet.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
      // a block posted by a worklet that has since been replaced is stale
      if (worklet !== this.worklet) return
      for (const analysis of this.analyses) {
        for (let offset = 0; offset < data.length;) {
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
    this.worklet = worklet
    this.input?.connect(worklet)
  }

  private async capture(kind: 'device' | 'loopback', fromClick = false): Promise<MediaStream> {
    if (kind === 'device') {
      return navigator.mediaDevices.getUserMedia({
        // the browser's voice processing would fight the analyzer's own gain control
        audio: { deviceId: this.state.settings.deviceId || undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
    }
    const blocked = systemAudioBlocked()
    if (blocked) throw new Error(blocked)
    if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') throw new Error(isTauri() ? 'System audio capture is not available in the desktop app on this system.' : 'This browser cannot capture system audio.')
    // a native menu item, a key or a graph that loads is no click for the browser, and Safari forgets a click across an await
    if (!fromClick && navigator.userActivation?.isActive === false) throw new DOMException('getDisplayMedia must be called from a user gesture handler', 'InvalidStateError')
    // Chrome only offers tab or system audio together with a video track; the video is dropped at once
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    stream.getVideoTracks().forEach((track) => track.stop())
    if (stream.getAudioTracks().length) return stream
    stream.getTracks().forEach((track) => track.stop())
    throw new Error(isMac()
      ? 'No audio was shared. Choose a Chrome Tab and tick Share tab audio; macOS does not share audio for windows or screens.'
      : 'No audio was shared. In the share dialog, tick the option to share tab or system audio.')
  }

  /** A failed capture leaves the running source connected: the old one goes only once the new stream is there. */
  private async connect(kind: AudioSourceKind, shared?: MediaStream) {
    const context = this.context!
    const stream = kind === 'file' ? null : shared ?? await this.capture(kind)
    this.disconnect()
    if (!stream) {
      // a media element can feed only one source node, ever, so both are kept for the life of the context
      this.element ??= Object.assign(new Audio(this.objectUrl ?? this.fileUrl), { loop: true, crossOrigin: 'anonymous' })
      this.elementSource ??= context.createMediaElementSource(this.element)
      this.input = this.elementSource
      this.input.connect(context.destination)
    } else {
      this.stream = stream
      this.input = context.createMediaStreamSource(stream)
      // not routed to the speakers: a microphone would feed back, and loopback audio is already playing
      void this.refreshDevices()
    }
    this.rebuildAnalysis()
  }

  private disconnect() {
    this.element?.pause()
    this.input?.disconnect()
    this.input = null
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
  }

  private fail(e: unknown) {
    const error = e as Error
    // WebKit: "getDisplayMedia must be called from a user gesture handler"; Chrome: "Must be handling a user gesture to show a permission request"
    if (/user gesture/i.test(error.message)) {
      this.state.sharePrompt = true
      log('Audio: the browser wants a click before it shows the share dialog', 'warn')
      return
    }
    this.state.error = error.name === 'NotAllowedError' ? 'Permission to capture audio was refused' : error.message
    log(`Audio: ${this.state.error}`, 'error')
  }
}
