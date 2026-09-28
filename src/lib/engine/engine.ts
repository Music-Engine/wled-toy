import { ref, watch } from 'vue'
import { config } from '@/lib/app/settings/config'
import { log, report } from '@/lib/app/logs'
import { ShaderRenderer } from '@/lib/engine/render/renderer'
import { AudioService } from '@/lib/audio/service'
import { systemAudioBlocked } from '@/lib/audio/settings'
import { createBridge } from '@/lib/bridge/bridge-client'
import { ImageLibrary } from '@/lib/engine/media/images'
import { layoutPositions } from '@/lib/engine/output/layout'
import type { OutputSettings } from '@/lib/engine/output/output'
import { LedOutput } from '@/lib/engine/output/led-output'
import { preferences } from '@/lib/app/settings/preferences'
import { createSlotTable, type GlslProgram, type ProgramUniform, type SlotTable } from '@/lib/graph'
import { MidiService } from './midi'
import { SceneFades } from './fades'
import { EngineMedia } from '@/lib/engine/media/engine-media'
import { Runtime } from './runtime'
import { FrameClock } from './clock'
import { openProgramResources, readShaderResources } from './program-resources'

let engine: Engine | null = null

export function useEngine(): Engine {
  engine ??= new Engine()
  return engine
}

/** Renderer, audio and bridge shared by both modes, so streaming survives a switch; the canvas moves to the active page */
class Engine {
  readonly canvas = document.createElement('canvas')
  readonly compileError = ref<string | null>(null)
  readonly audio = new AudioService('/assets/audio.mp3')
  readonly bridge = createBridge(config)
  readonly midi = new MidiService()
  readonly fades = new SceneFades()
  readonly images = new ImageLibrary()
  private readonly media = new EngineMedia(this.audio, this.images, () => this.renderer)
  private readonly ledOutput = new LedOutput(this.bridge, () => this.ledTick())
  readonly streaming = this.ledOutput.streaming
  readonly imageName = this.media.imageName
  /** Fate of the last picked track */
  readonly trackStatus = this.media.trackStatus

  private renderer: ShaderRenderer | null = null
  private runtime: Runtime | null = null
  private readonly stopWatchers: Array<() => void> = []
  private lastLedTick = performance.now()
  private lastPreview = performance.now()
  private readonly clock = new FrameClock()
  private rafId = 0

  constructor() {
    this.canvas.className = 'block aspect-video w-full'
    try {
      this.renderer = new ShaderRenderer(this.canvas)
      this.runtime = new Runtime(this.renderer)
    } catch (e) {
      report(e)
    }

    this.media.restore()
    void this.audio.configure({ source: preferences.audioSource === 'loopback' && systemAudioBlocked() ? 'file' : preferences.audioSource })

    this.bridge.connect()
    this.ledOutput.restart()
    this.rafId = requestAnimationFrame(this.renderLoop)
    this.stopWatchers.push(
      watch(() => config.fps, () => this.ledOutput.restart()),
      watch(() => config.layout, (layout) => this.renderer?.setLayout(layout && layoutPositions(layout)), { deep: true, immediate: true }),
      watch(() => [config.host, config.protocol, config.universe], () => this.bridge.sendConfig()),
    )
    log('WLEDtoy ready')
  }

  /** Hand-written shader; last graph's global state kept for its return */
  compile(code: string): boolean {
    return this.load({ pixel: code, frame: null, lineNodes: { pixel: [], frame: [] }, probes: {}, uniforms: [], resources: readShaderResources(code), output: null }, this.readSlots(), 'shader')
  }

  /** State laid out by `slots`, the table its compile returned; on failure the running program stays */
  load(program: GlslProgram, slots: SlotTable, source = 'graph'): boolean {
    if (!this.runtime) return false
    try {
      const ms = this.runtime.load(program, slots)
      this.compileError.value = null
      if (ms !== null) log(`Compiled ${source} in ${ms.toFixed(1)} ms`)
    } catch (e) {
      this.compileError.value = (e as Error).message
      log(`Compile failed (${source})`, 'error')
      return false
    }
    openProgramResources(program, { audio: this.audio, media: this.media, bridge: this.bridge, midi: this.midi, spectraWidth: this.renderer!.spectraWidth })
    this.setOutput(program.output)
    return true
  }

  /** For the next compile to keep */
  readSlots(): SlotTable {
    return this.runtime?.slots ?? createSlotTable()
  }

  /** Holds until written again or the next load */
  set(uniform: ProgramUniform, value: number) {
    this.runtime?.set(uniform, value)
  }

  /** Undefined when the probe is not in the running program */
  readProbe(nodeId: string): number | undefined {
    return this.runtime?.readProbe(nodeId)
  }

  useImage(file: { blob: Blob; name: string } | null, remember = true) {
    return this.media.useImage(file, remember)
  }

  useSong(file: { blob: Blob; name: string } | null, remember = true): Promise<boolean> {
    return this.media.useSong(file, remember)
  }

  /** Output node settings; null = plain Settings */
  setOutput(settings: OutputSettings | null) {
    this.ledOutput.setOutput(settings)
  }

  readLedFrame(): Uint8Array | null {
    return this.ledOutput.readLedFrame()
  }

  readLedRevision(): number {
    return this.ledOutput.readLedRevision()
  }

  toggleStream() {
    this.ledOutput.toggleStream()
  }

  async toggleAudio() {
    await this.audio.toggle()
  }

  /** Shader seconds since the last reset */
  readElapsed() {
    return this.clock.readElapsed()
  }

  resetTime() {
    this.clock.reset()
    this.runtime?.reset()
    log('Time reset')
  }

  dispose() {
    cancelAnimationFrame(this.rafId)
    this.ledOutput.stop()
    this.stopWatchers.forEach((stop) => stop())
    this.bridge.dispose()
    this.audio.dispose()
    this.renderer?.dispose()
  }

  private readonly renderLoop = () => {
    this.rafId = requestAnimationFrame(this.renderLoop)
    if (!this.runtime?.ready || !this.canvas.isConnected) return
    const now = performance.now()
    // rAF lands early or late; 2 ms slack keeps a 30 fps cap from skipping every third 60 Hz frame
    if (preferences.previewFps && now - this.lastPreview < 1000 / preferences.previewFps - 2) return
    this.renderer!.renderPreview(this.clock.fillParams(Math.min(0.1, (now - this.lastPreview) / 1000), config.ledCount, config.scanY), preferences.previewHeight)
    this.lastPreview = now
    this.clock.frame++
    this.bridge.countRender()
  }

  private ledTick() {
    // Before the ready check: a scene recalled while the shader fails to compile still lands
    this.fades.advance(performance.now())
    const { runtime } = this
    if (!runtime?.ready) return
    // Frame pass on the LED clock, which runs in a hidden tab; preview reads the same global state
    const now = performance.now()
    const params = this.clock.fillParams(Math.min(0.1, (now - this.lastLedTick) / 1000), config.ledCount, config.scanY)
    this.lastLedTick = now
    runtime.readMidiAndOsc(this.midi, this.bridge.oscArgs)
    const analyses = this.audio.features ? this.audio.takeFeatures() : null
    const [first, ...extra] = this.audio.slots
    if (first?.features) this.renderer!.setAudio(first.textures, extra.map((slot) => slot.textures), analyses?.[0] ?? null)
    const t0 = performance.now()
    this.ledOutput.finish(runtime.tick(params))
    this.bridge.recordLedRender(performance.now() - t0)
    this.fades.readSwitch(runtime)
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    engine?.dispose()
    engine = null
  })
}
