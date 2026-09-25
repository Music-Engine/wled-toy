import { fadeScene, type Scene } from '@/lib/graph'

/**
 * The one running scene fade. The engine advances it on the LED clock, which keeps running in a hidden tab, so a fade
 * finishes there too, and it outlives the panel that started it. A new start takes over from wherever the last had got to.
 */
export class SceneFades {
  private from: Record<string, number> = {}
  private scene: Scene | null = null
  private started = 0
  private seconds = 0
  private write: (id: string, value: number) => void = () => undefined

  /** Moves every knob in `from` to the scene over `seconds`, writing each value through `write`; the first write is now. */
  start(from: Record<string, number>, scene: Scene, seconds: number, write: (id: string, value: number) => void, now: number) {
    this.from = from
    this.scene = scene
    this.seconds = seconds
    this.started = now
    this.write = write
    this.advance(now)
  }

  advance(now: number) {
    const { scene } = this
    if (!scene) return
    const t = this.seconds <= 0 ? 1 : (now - this.started) / 1000 / this.seconds
    if (t >= 1) this.scene = null
    for (const [id, value] of Object.entries(fadeScene(this.from, scene, t))) this.write(id, value)
  }
}
