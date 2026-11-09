import type { StoredNode } from './doc'
import { newId } from '@/lib/util/ids'

/** A snapshot of every Knob: values by knob node id. */
export interface Scene {
  id: string
  name: string
  values: Record<string, number>
}

const isKnob = (node: StoredNode) => node.data.kind === 'knob'

export function captureScene(nodes: StoredNode[], name: string): Scene {
  const values = Object.fromEntries(nodes.filter(isKnob).map((n) => [n.id, typeof n.data.values.value === 'number' ? n.data.values.value : 0.5]))
  return { id: `scene-${newId()}`, name, values }
}

/**
 * Knob values `t` of the way (0 to 1) from where they were to a scene. Knobs the scene does not know stay put,
 * and at t = 1 the result is the scene's own numbers, not a rounded approximation of them.
 */
export function fadeScene(from: Record<string, number>, scene: Scene, t: number): Record<string, number> {
  const progress = Math.min(1, Math.max(0, t))
  return Object.fromEntries(
    Object.entries(from).map(([id, start]) => {
      const target = scene.values[id]
      if (target === undefined) return [id, start]
      return [id, progress === 1 ? target : start + (target - start) * progress]
    }),
  )
}

/** Drops values of knobs that no longer exist, so scenes do not accumulate ids of deleted nodes. */
export function pruneScenes(scenes: Scene[], nodes: StoredNode[]): Scene[] {
  const knobs = new Set(nodes.filter(isKnob).map((n) => n.id))
  return scenes.map((scene) => ({ ...scene, values: Object.fromEntries(Object.entries(scene.values).filter(([id]) => knobs.has(id))) }))
}

/** Scenes from a stored graph; anything malformed is left out rather than breaking the load. */
export function parseScenes(raw: unknown): Scene[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((scene: Partial<Scene> | null) => {
    if (!scene || typeof scene.id !== 'string' || typeof scene.name !== 'string' || typeof scene.values !== 'object' || scene.values === null) return []
    const values = Object.fromEntries(Object.entries(scene.values).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)))
    return [{ id: scene.id, name: scene.name, values }]
  })
}
