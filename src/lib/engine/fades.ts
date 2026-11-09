import { fadeScene, type Scene } from '@/lib/graph'

/**
 * The one running scene fade, advanced on the LED clock so it finishes in a hidden tab and outlives its panel; a new
 * start takes over mid-fade. Scene Switch probe read on the same clock
 */
export class SceneFades {
  private from: Record<string, number> = {}
  private scene: Scene | null = null
  private started = 0
  private seconds = 0
  private write: (id: string, value: number) => void = () => undefined
  private switch: (SceneSwitch & { index: number }) | null = null

  /** Moves each knob in `from` to the scene over `seconds` via `write`; first write now */
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

  /** Recalls a scene whenever the switch asks for a new index; null stops */
  followSwitch(sceneSwitch: SceneSwitch | null) {
    this.switch = sceneSwitch && { ...sceneSwitch, index: -1 }
  }

  /** After the LED tick's probes are read back */
  readSwitch(probes: { readProbe(nodeId: string): number | undefined }) {
    const followed = this.switch
    if (!followed) return
    const index = probes.readProbe(followed.nodeId)
    if (index === undefined || index === followed.index) return
    followed.index = index
    followed.recall(index)
  }
}

/** Scene Switch node of the running graph and its scene recall */
export interface SceneSwitch {
  nodeId: string
  recall: (index: number) => void
}
