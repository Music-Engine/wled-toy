// A node can be both planned per frame and emitted per pixel today (Time feeding an Integrator and a shader node), so
// this pass answers both questions; settling each node on one placement is a decision for the Program slice.
import { fallsBackToImplicit, hasFrameValue, isLinkable } from '@/lib/graph/define/shape'
import type { Compilation } from './compilation'

interface Walk {
  c: Compilation
  emitted: Set<string>
  planned: Set<string>
  perFrame: Map<string, boolean>
}

/**
 * Fills `c.placement`, where a pixel consumer reads each node from, and `c.changesPerPixel`, the nodes a frame consumer
 * cannot plan, walking from the sinks in the order emission and planning will.
 */
export function placeNodes(c: Compilation, sinks: string[]): void {
  const walk: Walk = { c, emitted: new Set(), planned: new Set(), perFrame: new Map() }
  for (const id of sinks) {
    const { shape } = c.lookup(id)
    if (!shape.exec && !shape.run) continue
    if (place(walk, id) === 'frame') planPerFrame(walk, id)
    else readPerPixel(walk, id)
  }
}

function readPerPixel(walk: Walk, id: string): void {
  const placement = place(walk, id)
  // standalone, a per-frame output is frozen into the code and nothing upstream of it runs
  if (placement === 'frame' && !walk.c.standalone) return planPerFrame(walk, id)
  if (placement === 'frame' || walk.emitted.has(id)) return
  walk.emitted.add(id)
  for (const source of linkedSources(walk.c, id)) readPerPixel(walk, source)
}

function planPerFrame(walk: Walk, id: string): void {
  if (walk.planned.has(id)) return
  walk.planned.add(id)
  for (const source of linkedSources(walk.c, id)) {
    if (canRunPerFrame(walk, source)) planPerFrame(walk, source)
  }
}

function place(walk: Walk, id: string): 'frame' | 'pixel' {
  const known = walk.c.placement.get(id)
  if (known) return known
  const placement = readsPerFrame(walk, id) ? 'frame' : 'pixel'
  walk.c.placement.set(id, placement)
  return placement
}

/** A node that can run either way goes per frame as soon as something is linked in and all of it is per-frame. */
function readsPerFrame(walk: Walk, id: string): boolean {
  const { shape } = walk.c.lookup(id)
  if (!shape.exec) return true
  if (walk.c.standalone || !shape.run) return false
  return linkedSources(walk.c, id).length > 0 && canRunPerFrame(walk, id)
}

/** The node has `run` and nothing per-pixel reaches it; a loop counts as per-pixel. */
function canRunPerFrame(walk: Walk, id: string, trail = new Set<string>()): boolean {
  const known = walk.perFrame.get(id)
  if (known !== undefined) return known
  if (trail.has(id)) return false
  trail.add(id)
  const { node, shape } = walk.c.lookup(id)
  const result = shape.run !== undefined && shape.inputs.filter(isLinkable).every((socket) => {
    const source = walk.c.linkSource(id, socket)
    if (source) return canRunPerFrame(walk, source.id, trail)
    // an unlinked socket that falls back to `uv.x` or `iTime` only exists in the shader
    return !fallsBackToImplicit(node.data.values, socket) || hasFrameValue(socket)
  })
  walk.perFrame.set(id, result)
  if (!result) walk.c.changesPerPixel.add(id)
  return result
}

function linkedSources(c: Compilation, id: string): string[] {
  return c.lookup(id).shape.inputs.filter(isLinkable).flatMap((socket) => c.linkSource(id, socket)?.id ?? [])
}
