// Generic widths: each node's generic sockets resolve to the widest value linked or stored on them. Topo order puts
// every source first, so one pass over the nodes settles them all.
import type { Socket } from '@/lib/graph/define/shape'
import { fallsBackToImplicit } from '@/lib/graph/registry'
import type { Annotation, CompileContext, CompiledNode } from '@/lib/graph/compile/next/context'
import { isGenericSocket, linkedOutput, storedValue } from '@/lib/graph/compile/next/sockets'

export const width = (): Annotation => ({
  name: 'width',
  reads: [],
  annotate: (ctx) => {
    for (const id of ctx.order) {
      const node = ctx.nodes[id]
      const counts = node.shape.inputs.filter(isGenericSocket).map((socket) => componentCount(ctx, node, socket))
      node.width = Math.max(1, ...counts)
    }
  },
})

/** Components the socket arrives with, before it is cast to the node's width. */
function componentCount(ctx: CompileContext, node: CompiledNode, socket: Socket): number {
  const linked = linkedOutput(ctx, node, socket)
  if (linked) return linked.type.id === 'genType' ? ctx.nodes[linked.source.id].width! : linked.type.dim ?? 1
  if (fallsBackToImplicit(node.values, socket)) return 1
  const stored = storedValue(node, socket)
  return Array.isArray(stored) ? stored.length : 1
}
