import { ref, watch } from 'vue'
import { config } from '@/lib/app/config'
import { log, report } from '@/lib/app/logs'
import { ShaderRenderer, type FrameParams } from './renderer'
import { AudioService, systemAudioBlocked } from '@/lib/audio/service'
import { createBridge } from '@/lib/bridge/bridge-client'
import { ImageLibrary } from './images'
import { layoutPositions } from './layout'
import { DEFAULT_OUTPUT, LedPostProcess, type OutputSettings } from './output'
import { preferences } from '@/lib/app/preferences'
import { FrameRunner, type FramePlan } from '@/lib/graph/compile/js/frame'
import type { AnalysisSettings, AudioSourceRequest } from '@/lib/audio/service'
import { MidiService } from './midi'
import { SceneFades } from './fades'
import { EngineMedia } from './engine-media'

type LedListener = (frame: Uint8Array) => void

/**
 * One renderer, audio source and UDP bridge shared by shader and graph mode, so
 * streaming keeps running while switching modes. The preview canvas is moved
 * into whichever page is currently active.
 */
class Engine {
  readonly canvas = document.createElement('canvas')
  readonly streaming = ref(false)
  readonly compileError = ref<string | null>(null)
  readonly audio = new AudioService('/assets/audio.mp3')
  readonly bridge = createBridge(config)
  readonly midi = new MidiService()
  readonly fades = new SceneFades()
  readonly images = new ImageLibrary()
  private readonly media = new EngineMedia(this.audio, this.images, () => this.renderer)
  /** Name of the image the shader samples, for the UI. */
  readonly imageName = this.media.imageName
  /** What happened to the last track the user picked, for the places that offer the choice. */
  readonly trackStatus = this.media.trackStatus

  private renderer: ShaderRenderer | null = null
  private readonly listeners = new Set<LedListener>()
  private readonly stopWatchers: Array<() => void> = []
  private readonly controls = new FrameRunner()
  private readonly post = new LedPostProcess()
  private output: OutputSettings = DEFAULT_OUTPUT
  private lastControlStep = performance.now()
  private lastPreview = performance.now()
  private startTime = performance.now()
  private frame = 0
  private rafId = 0
  private sendTimer: ReturnType<typeof setInterval> | undefined

  constructor() {
    this.canvas.className = 'block aspect-video w-full'
    try {
      this.renderer = new ShaderRenderer(this.canvas)
    } catch (e) {
      report(e)
    }

    this.media.restore()
    void this.audio.configure({ source: preferences.audioSource === 'loopback' && systemAudioBlocked() ? 'file' : preferences.audioSource })

    this.bridge.connect()
    this.restartSendTimer()
    this.rafId = requestAnimationFrame(this.renderLoop)
    this.stopWatchers.push(
      watch(() => config.fps, () => this.restartSendTimer()),
      watch(() => config.layout, (layout) => this.renderer?.setLayout(layout && layoutPositions(layout)), { deep: true, immediate: true }),
      watch(() => [config.host, config.protocol, config.universe], () => this.bridge.sendConfig()),
    )
    log('WLEDtoy ready')
  }

  compile(code: string, source: string): boolean {
    if (!this.renderer) return false
    // hand-written shaders have no CPU side; a graph sets its plan before it compiles
    if (source === 'shader') {
      this.setControlPlan()
      this.setOutput(null)
    }
    try {
      const ms = this.renderer.compile(code)
      this.compileError.value = null
      log(`Compiled ${source} in ${ms.toFixed(1)} ms`)
      return true
    } catch (e) {
      this.compileError.value = (e as Error).message
      log(`Compile failed (${source})`, 'error')
      return false
    }
  }

  /** What graph mode computes on the CPU each frame. Shader mode passes nothing. Node state carries over between plans. */
  setControlPlan(plan: FramePlan = { steps: [], exports: [], resources: {} }) {
    this.controls.load(plan)
    // the graph's Audio Source says what is captured (the first one, if it has several); its FFT nodes say how it is analyzed
    const [source] = (plan.resources.audioSource ?? []) as AudioSourceRequest[]
    if (source) void this.audio.configure(source)
    this.audio.setAnalyses((plan.resources.analysis ?? []) as AnalysisSettings[])
    void this.media.showImages((plan.resources.image ?? []) as string[])
    const [oscPort = 0] = (plan.resources.osc ?? []) as number[]
    this.bridge.listenOsc(oscPort)
    // asking for MIDI shows a permission prompt, so it waits until a graph actually uses it
    if (plan.steps.some((step) => step.kind === 'midiIn')) void this.midi.enable()
  }

  useImage(file: { blob: Blob; name: string } | null, remember = true) {
    return this.media.useImage(file, remember)
  }

  useSong(file: { blob: Blob; name: string } | null, remember = true): Promise<boolean> {
    return this.media.useSong(file, remember)
  }

  /** How frames are finished and sent. A graph passes its Output node's settings; null goes back to plain Settings. */
  setOutput(settings: OutputSettings | null) {
    const next = settings ?? DEFAULT_OUTPUT
    const wireChanged = next.protocol !== this.output.protocol || next.universe !== this.output.universe
    const fpsChanged = next.fps !== this.output.fps
    this.output = next
    if (wireChanged) this.bridge.sendConfig(next.protocol === 'settings' ? null : { protocol: next.protocol, universe: next.universe })
    if (fpsChanged) this.restartSendTimer()
  }

  /** The latest value a control-rate node produced, or undefined when it is not part of the running graph. */
  controlOutput(nodeId: string, output: string) {
    return this.controls.output(nodeId, output)
  }

  onLedFrame(listener: LedListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  toggleStream() {
    this.streaming.value = !this.streaming.value
    if (this.streaming.value && !config.host) log('No host set; open Settings to target a WLED device', 'warn')
    log(this.streaming.value ? 'Streaming started' : 'Streaming stopped')
  }

  async toggleAudio() {
    await this.audio.toggle()
  }

  /** Seconds of shader time since the last reset. */
  elapsed() {
    return (performance.now() - this.startTime) / 1000
  }

  resetTime() {
    this.startTime = performance.now()
    this.frame = 0
    this.controls.reset()
    this.renderer?.resetFeedback()
    log('Time reset')
  }

  dispose() {
    cancelAnimationFrame(this.rafId)
    clearInterval(this.sendTimer)
    this.stopWatchers.forEach((stop) => stop())
    this.bridge.dispose()
    this.audio.dispose()
    this.renderer?.dispose()
  }

  // one object for both passes so neither allocates per frame; the renderer reads it during the call and keeps no reference
  private readonly params: FrameParams = { time: 0, dt: 0, frame: 0, ledCount: 0, scanY: 0 }

  private frameParams(dt: number): FrameParams {
    const { params } = this
    params.time = this.elapsed()
    params.dt = dt
    params.frame = this.frame
    params.ledCount = config.ledCount
    params.scanY = config.scanY
    return params
  }

  private restartSendTimer() {
    clearInterval(this.sendTimer)
    this.sendTimer = setInterval(this.ledTick, 1000 / (this.output.fps || config.fps))
  }

  private readonly renderLoop = () => {
    this.rafId = requestAnimationFrame(this.renderLoop)
    if (!this.renderer?.ready || !this.canvas.isConnected) return
    const now = performance.now()
    // rAF ticks land a little early or late; the 2 ms slack keeps a 30 fps cap from skipping every third frame of a 60 Hz display
    if (preferences.previewFps && now - this.lastPreview < 1000 / preferences.previewFps - 2) return
    this.renderer.renderPreview(this.frameParams(Math.min(0.1, (now - this.lastPreview) / 1000)), preferences.previewHeight)
    this.lastPreview = now
    this.frame++
    this.bridge.countRender()
  }

  // LED output runs on a timer, not rAF, so it keeps going when the tab is hidden
  private readonly ledTick = () => {
    // before the ready check: a scene recalled while the shader does not compile still lands
    this.fades.advance(performance.now())
    if (!this.renderer?.ready) return
    // control nodes advance on the LED clock, the one that keeps running in a hidden tab; the preview reads the same values
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.lastControlStep) / 1000)
    const params = this.frameParams(dt)
    this.renderer.setControls(this.controls.step({
      time: params.time,
      dt,
      frameIndex: params.frame,
      audio: this.audio.features ? { analyses: this.audio.takeFeatures(), sampleRate: this.audio.state.sampleRate } : undefined,
      midi: this.midi,
      osc: this.bridge.oscArgs,
    }))
    this.lastControlStep = now
    const [first, ...extra] = this.audio.slots
    if (first?.features) this.renderer.setAudio(first.textures, extra.map((slot) => slot.textures))
    const t0 = performance.now()
    const leds = this.post.process(this.renderer.renderLeds(params), config.brightness, this.output)
    this.bridge.recordLedRender(performance.now() - t0)
    if (!document.hidden) this.listeners.forEach((listener) => listener(leds))
    if (this.streaming.value) this.bridge.sendFrame(leds)
  }
}

let engine: Engine | null = null

export function useEngine(): Engine {
  engine ??= new Engine()
  return engine
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    engine?.dispose()
    engine = null
  })
}
