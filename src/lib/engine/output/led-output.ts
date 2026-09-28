import { ref } from 'vue'
import { config } from '@/lib/app/settings/config'
import { log } from '@/lib/app/logs'
import type { Bridge } from '@/lib/bridge/bridge-client'
import { DeadlineTimer } from '@/lib/engine/clock'
import { DEFAULT_OUTPUT, LedPostProcess, type OutputSettings } from './output'

/** LED frames on their deadline clock: finished, kept for views, streamed */
export class LedOutput {
  readonly streaming = ref(false)
  private leds: Uint8Array | null = null
  private revision = 0
  private readonly post = new LedPostProcess()
  private output: OutputSettings = DEFAULT_OUTPUT
  // Timer, not rAF, so LEDs keep going in a hidden tab
  private readonly timer = new DeadlineTimer(() => this.tick(), () => 1000 / (this.output.fps || config.fps))

  constructor(private readonly bridge: Bridge, private readonly tick: () => void) {}

  restart() {
    this.timer.restart()
  }

  stop() {
    this.timer.stop()
  }

  /** Output node settings; null = plain Settings */
  setOutput(settings: OutputSettings | null) {
    const next = settings ?? DEFAULT_OUTPUT
    const wireChanged = next.protocol !== this.output.protocol || next.universe !== this.output.universe
    const fpsChanged = next.fps !== this.output.fps
    this.output = next
    if (wireChanged) this.bridge.sendConfig(next.protocol === 'settings' ? null : { protocol: next.protocol, universe: next.universe })
    if (fpsChanged) this.timer.restart()
  }

  /** Post-processes one tick's colors and streams them */
  finish(colors: Float32Array) {
    const leds = this.post.process(colors, config.brightness, this.output)
    this.leds = leds
    this.revision++
    if (this.streaming.value) this.bridge.sendFrame(leds)
  }

  /** 4 header bytes then RGB triplets; null before the first tick. Views read it on their own clock, never inside the tick */
  readLedFrame(): Uint8Array | null {
    return this.leds
  }

  /** Counts LED ticks, so a view skips a frame it already drew */
  readLedRevision(): number {
    return this.revision
  }

  toggleStream() {
    this.streaming.value = !this.streaming.value
    if (this.streaming.value && !config.host) log('No host set; open Settings to target a WLED device', 'warn')
    log(this.streaming.value ? 'Streaming started' : 'Streaming stopped')
  }
}
