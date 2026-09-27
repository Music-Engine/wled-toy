import type { Socket } from '@/lib/graph/define/shape'
import { fallsBackToImplicit } from '@/lib/graph/registry'
import type { Annotation, CompileContext, CompiledNode } from '@/lib/graph/compile/context'
import { isGenericSocket, findLinkedOutput, readStoredValue } from '@/lib/graph/compile/sockets'

/** Generic sockets resolve to the widest value linked or stored; topo order settles sources first */
export const inferWidth = (): Annotation => ({
  name: 'width',
  reads: [],
  annotate: (ctx) => {
    for (const id of ctx.order) {
      const node = ctx.nodes[id]
      const counts = node.shape.inputs.filter(isGenericSocket).map((socket) => countComponents(ctx, node, socket))
      node.width = Math.max(1, ...counts)
    }
  },
})

/** Before the cast to node width */
function countComponents(ctx: CompileContext, node: CompiledNode, socket: Socket): number {
  const linked = findLinkedOutput(ctx, node, socket)
  if (linked) return linked.type.id === 'genType' ? ctx.nodes[linked.source.id].width! : linked.type.dim ?? 1
  if (fallsBackToImplicit(node.values, socket)) return 1
  const stored = readStoredValue(node, socket)
  return Array.isArray(stored) ? stored.length : 1
}
