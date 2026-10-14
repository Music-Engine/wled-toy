import type { Socket } from '@/lib/graph/define/shape'
import { canCast } from '@/lib/graph/define/types'
import type { Check, CompiledNode, CompileContext, GraphIssue } from '@/lib/graph/compile/context'

/** Stream input fed by another type or a missing output; value input fed by a stream */
export const checkLinkTypes = (): Check => ({
  name: 'checkLinkTypes',
  reads: [],
  check: (ctx) => ctx.order.flatMap((id) => ctx.nodes[id].shape.inputs.flatMap((socket) => findLinkIssue(ctx, ctx.nodes[id], socket))),
})

function findLinkIssue(ctx: CompileContext, node: CompiledNode, socket: Socket): GraphIssue[] {
  const source = node.links[socket.name]
  if (!source) return []
  const from = ctx.nodes[source.id].shape.outputs.find((out) => out.name === source.output)
  if (socket.type.kind === 'stream' && (!from || !canCast(from.type, socket.type))) {
    return [{ nodeId: node.id, message: `${socket.label} needs ${socket.type.label}, not ${from?.type.label ?? 'a missing output'}` }]
  }
  if (socket.type.kind !== 'stream' && from && from.type.kind !== 'value')
    return [{ nodeId: node.id, message: `${socket.label} needs a number or a color, not ${from.type.label}` }]
  return []
}
