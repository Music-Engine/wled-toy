import { ref, watch } from 'vue'
import { config } from '@/lib/app/config'
import { log } from '@/lib/app/logs'
import { checkTrackFile, formatDuration } from '@/lib/audio/track-file'
import { ShaderRenderer, type FrameParams } from './renderer'
import { AudioService, systemAudioBlocked } from '@/lib/audio/service'
import { createBridge } from '@/lib/bridge/bridge-client'
import { ImageLibrary } from './images'
import { layoutPositions } from './layout'
import { DEFAULT_OUTPUT, LedPostProcess, type OutputSettings } from './output'
import { preferences } from '@/lib/app/preferences'
import { ControlRunner, type ControlPlan } from '@/lib/graph/compile/control'
import type { AudioSourceRequest } from '@/lib/graph/nodes/audio/audio'
import type { AnalysisSettings } from '@/lib/audio/service'
import { oscPortFrom } from '@/lib/graph/nodes/control/midi-osc'
import { loadMedia, saveMedia, clearMedia, type MediaKey } from './media-store'
import { MidiService } from './midi'

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
  readonly images = new ImageLibrary()
  // library ids per layer of the renderer's image array, as last uploaded
  private imageLayers: string[] = []

  private renderer: ShaderRenderer | null = null
  private readonly listeners = new Set<LedListener>()
  private readonly stopWatchers: Array<() => void> = []
  private readonly controls = new ControlRunner()
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
      log((e as Error).message, 'error')
    }

    this.showImage('/assets/image.jpg')
    // the user's own song and image from an earlier visit, when there are any
    void loadMedia('image').then((stored) => stored && this.useImage(stored, false)).catch(() => undefined)
    void loadMedia('song').then((stored) => stored && this.useSong(stored, false)).catch(() => undefined)
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
  setControlPlan(plan: ControlPlan = { steps: [], exports: [], resources: {} }) {
    this.controls.load(plan)
    // the graph's Audio Source says what is captured (the first one, if it has several); its FFT nodes say how it is analyzed
    const [source] = (plan.resources.audioSource ?? []) as AudioSourceRequest[]
    if (source) void this.audio.configure(source)
    this.audio.setAnalyses((plan.resources.analysis ?? []) as AnalysisSettings[])
    void this.showImages((plan.resources.image ?? []) as string[])
    const oscStep = plan.steps.find((step) => step.kind === 'oscIn')
    this.bridge.listenOsc(oscStep ? oscPortFrom(oscStep.inputs) : 0)
    // asking for MIDI shows a permission prompt, so it waits until a graph actually uses it
    if (plan.steps.some((step) => step.kind === 'midiIn')) void this.midi.enable()
  }

  /** Decodes the images a graph's Image Texture nodes picked into the renderer's layers; only layers that changed are redone. */
  private async showImages(ids: string[]) {
    await this.images.ready
    ids.forEach((id, layer) => {
      if (this.imageLayers[layer] === id) return
      const image = this.images.get(id)
      if (!image) return log(`Image "${id}" is not in the library any more; open it again on its node`, 'warn')
      this.imageLayers[layer] = id
      const element = new Image()
      element.onload = () => this.imageLayers[layer] === id && this.renderer?.setImageLayer(layer, element)
      element.onerror = () => log(`${image.name} could not be read as an image`, 'error')
      element.src = image.url
    })
  }

  /** Name of the image the shader samples, for the UI. */
  readonly imageName = ref('Built-in image')

  /** Uses this picture as the image texture and remembers it for the next visit; null restores the built-in one. */
  async useImage(file: { blob: Blob; name: string } | null, remember = true) {
    const url = file ? URL.createObjectURL(file.blob) : '/assets/image.jpg'
    this.showImage(url, () => file && URL.revokeObjectURL(url))
    this.imageName.value = file?.name ?? 'Built-in image'
    if (remember) await this.remember('image', file)
  }

  /** Plays this song as the audio file source and remembers it; null restores the built-in track. */
  /** What happened to the last track the user picked, for the places that offer the choice. */
  readonly trackStatus = ref<{ level: 'info' | 'error'; message: string } | null>(null)

  /** Swaps the track now and, with `remember`, keeps it for the next launch. False when the file is not playable audio. */
  async useSong(file: { blob: Blob; name: string } | null, remember = true): Promise<boolean> {
    if (file && remember) {
      const check = await checkTrackFile(file)
      if (!check.ok) {
        this.trackStatus.value = { level: 'error', message: `${check.reason} The track was not changed.` }
        log(check.reason, 'error')
        return false
      }
      await this.audio.setFile(file)
      await this.remember('song', file)
      const playing = this.audio.state.playing && this.audio.state.settings.source === 'file'
      this.trackStatus.value = { level: 'info', message: `${file.name} (${formatDuration(check.seconds)}) is the default track now and at every launch. ${playing ? 'It is playing.' : 'It starts when you press Play.'}` }
      return true
    }
    await this.audio.setFile(file)
    if (remember) {
      await this.remember('song', file)
      this.trackStatus.value = { level: 'info', message: 'Back to the built-in track, now and at every launch.' }
    }
    return true
  }

  private async remember(key: MediaKey, file: { blob: Blob; name: string } | null) {
    try {
      await (file ? saveMedia(key, file) : clearMedia(key))
    } catch (e) {
      log(`Could not keep the ${key} for next time: ${(e as Error).message}`, 'warn')
    }
  }

  private showImage(url: string, done?: () => void) {
    const img = new Image()
    img.onload = () => {
      this.renderer?.setImage(img)
      log(`Image texture loaded (${img.width}x${img.height})`)
      done?.()
    }
    img.onerror = () => {
      log('That file could not be read as an image', 'error')
      done?.()
    }
    img.src = url
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

  private frameParams(): FrameParams {
    return { time: this.elapsed(), frame: this.frame, ledCount: config.ledCount, scanY: config.scanY }
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
    this.renderer.renderPreview({ ...this.frameParams(), dt: Math.min(0.1, (now - this.lastPreview) / 1000) }, preferences.previewHeight)
    this.lastPreview = now
    this.frame++
    this.bridge.countRender()
  }

  // LED output runs on a timer, not rAF, so it keeps going when the tab is hidden
  private readonly ledTick = () => {
    if (!this.renderer?.ready) return
    // control nodes advance on the LED clock, the one that keeps running in a hidden tab; the preview reads the same values
    const now = performance.now()
    const dt = Math.min(0.1, (now - this.lastControlStep) / 1000)
    const params = { ...this.frameParams(), dt }
    this.renderer.setControls(this.controls.step({
      time: params.time,
      dt,
      frame: params.frame,
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
