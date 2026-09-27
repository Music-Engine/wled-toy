import type { Socket } from '@/lib/graph/define/shape'
import { fallsBackToImplicit, existsInFramePass, listValueInputs } from '@/lib/graph/registry'
import type { Annotation, CompileContext, CompiledNode } from '@/lib/graph/compile/context'
import { findLinkedOutput } from '@/lib/graph/compile/sockets'

/** Frame seeded by state, probes and `prefers: 'frame'`, flowing downstream until a per-pixel input and upstream to all it reads; the rest per pixel */
export const choosePass = (): Annotation => ({
  name: 'pass',
  reads: ['resources'],
  annotate: (ctx) => {
    const forced = collectForcedPixel(ctx)
    const frame = new Set(ctx.order.filter((id) => !forced.has(id) && needsFrame(ctx.nodes[id])))
    // Upstream nodes joining can give their other readers a frame input, so repeat until stable
    for (let size = -1; size !== frame.size;) {
      size = frame.size
      for (const id of ctx.order) {
        if (!forced.has(id) && Object.values(ctx.nodes[id].links).some((source) => frame.has(source.id))) frame.add(id)
      }
      for (const id of [...ctx.order].reverse()) {
        if (!forced.has(id) && isReadInFramePass(ctx, frame, id)) frame.add(id)
      }
    }
    for (const id of ctx.order) ctx.nodes[id].pass = frame.has(id) ? 'frame' : 'pixel'
  },
})

/** `varies`, a pixel-only implicit input, or a link from such a node */
function collectForcedPixel(ctx: CompileContext): Set<string> {
  const forced = new Set<string>()
  for (const id of ctx.order) {
    const node = ctx.nodes[id]
    if (node.shape.varies === 'pixel' || listValueInputs(node.shape).some((socket) => isReadPerPixel(ctx, forced, node, socket))) forced.add(id)
  }
  return forced
}

/** Link from a forced node, or an implicit expression only the pixel pass has (`uv.x`, not `iTime`) */
function isReadPerPixel(ctx: CompileContext, forced: Set<string>, node: CompiledNode, socket: Socket): boolean {
  const linked = findLinkedOutput(ctx, node, socket)
  if (linked) return forced.has(linked.source.id)
  return fallsBackToImplicit(node.values, socket) && !existsInFramePass(socket)
}

const needsFrame = ({ shape }: CompiledNode) => Boolean(shape.state || shape.probe || shape.prefers === 'frame')

const isReadInFramePass = (ctx: CompileContext, frame: Set<string>, id: string) =>
  [...frame].some((reader) => Object.values(ctx.nodes[reader].links).some((source) => source.id === id))
