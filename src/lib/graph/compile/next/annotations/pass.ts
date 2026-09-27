// Which function each node is emitted into. A node runs per pixel when its definition varies per pixel or anything it
// reads does; everything else runs once per frame, in global state. Topo order settles every source first.
import type { Socket } from '@/lib/graph/define/shape'
import { fallsBackToImplicit, hasFrameValue, valueInputs } from '@/lib/graph/registry'
import { GraphError } from '@/lib/graph/compile/front-end/program'
import type { Annotation, CompileContext, CompiledNode, Pass } from '@/lib/graph/compile/next/context'
import { linkedOutput } from '@/lib/graph/compile/next/sockets'

export const pass = (): Annotation => ({
  name: 'pass',
  reads: ['resources'],
  annotate: (ctx) => {
    for (const id of ctx.order) ctx.nodes[id].pass = nodePass(ctx, ctx.nodes[id])
  },
})

/** A node without a body emits nothing, and its uniforms read the same in either pass; a JavaScript-only node cannot be emitted at all. */
function nodePass(ctx: CompileContext, node: CompiledNode): Pass {
  const { shape } = node
  if (shape.frame && !shape.body && !ctx.uniforms.some((uniform) => uniform.node === node.id)) throw new GraphError(`${shape.title} runs only in JavaScript and has no body to emit yet`, node.id)
  if (shape.varies === 'pixel') return 'pixel'
  return valueInputs(shape).some((socket) => readsPerPixel(ctx, node, socket)) ? 'pixel' : 'frame'
}

/** A link from a per-pixel node, or, unlinked, an implicit expression only the pixel pass has (`uv.x`, but not `iTime`). */
function readsPerPixel(ctx: CompileContext, node: CompiledNode, socket: Socket): boolean {
  const linked = linkedOutput(ctx, node, socket)
  if (linked) return ctx.nodes[linked.source.id].pass === 'pixel'
  return fallsBackToImplicit(node.values, socket) && !hasFrameValue(socket)
}
