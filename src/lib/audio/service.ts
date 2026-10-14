import { reactive } from 'vue'
import { log, report } from '@/lib/app/logs'
import { AnalysisSlots } from './analysis-slots'
import { captureAudio } from './capture'
import type { Features } from './dsp'
import { DEFAULT_AUDIO, type AnalysisSettings, type AudioSettings, type AudioSourceKind } from './settings'
import type { AudioTextures } from './textures'
import { sameJson } from '@/lib/util/json'

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

  private readonly analysis = new AnalysisSlots()

  /** Features of the default analysis, or null until audio has run once. */
  get features(): Features | null {
    return this.analysis.features
  }

  /** Textures of the default analysis; previews and hand-written shaders read these. */
  get textures(): AudioTextures {
    return this.analysis.textures
  }

  /** Per slot: what the shader and the control nodes read. Empty until audio has run. */
  get slots(): { textures: AudioTextures; features: Features | null }[] {
    return this.analysis.slots
  }

  /** Per slot, the newest features with the pulses raised since the previous call; see `AnalysisSlots.takeFeatures`. */
  takeFeatures(): (Features | null)[] {
    return this.analysis.takeFeatures()
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

    const levelsChanged = !sameJson([next.agc, next.gate], [before.agc, before.gate])
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
        if (!this.input) await this.connect(before.source).catch((e) => report(e, `Audio: going back to ${before.source}`))
      }
    }
  }

  /** For the click handler of a real button: the share picker is asked for before anything is awaited, while the click still counts as the user's gesture. */
  async shareSystemAudio() {
    this.state.error = null
    this.state.sharePrompt = false
    let stream: MediaStream | undefined
    try {
      stream = await captureAudio('loopback', this.state.settings.deviceId, true)
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
    if (this.analysis.want(extra) && this.context) this.rebuildAnalysis()
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
    this.analysis.rebuild({ agc, gate }, context.sampleRate)
    this.worklet?.disconnect()
    const worklet = new AudioWorkletNode(context, 'hop-processor', { numberOfOutputs: 0, processorOptions: { hop: this.analysis.block, channel } })
    worklet.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
      // a block posted by a worklet that has since been replaced is stale
      if (worklet === this.worklet) this.analysis.feed(data)
    }
    this.worklet = worklet
    this.input?.connect(worklet)
  }

  /** A failed capture leaves the running source connected: the old one goes only once the new stream is there. */
  private async connect(kind: AudioSourceKind, shared?: MediaStream) {
    const context = this.context!
    const stream = kind === 'file' ? null : (shared ?? (await captureAudio(kind, this.state.settings.deviceId)))
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
