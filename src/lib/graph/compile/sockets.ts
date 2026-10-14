import type { Socket } from '@/lib/graph/define/shape'
import type { DataType } from '@/lib/graph/define/types'
import { GraphError, type CompileContext, type CompiledNode, type LinkSource, type ProgramUniform } from './context'

export const isGenericSocket = (socket: Socket) => socket.linkable && socket.type.id === 'genType'

/** Number or vector output linked in; a missing or stream output reads as unlinked, `checkLinkTypes` refuses the stream */
export function findLinkedOutput(ctx: CompileContext, node: CompiledNode, socket: Socket): { source: LinkSource; type: DataType<any> } | undefined {
  const source = node.links[socket.name]
  const out = source && ctx.nodes[source.id].shape.outputs.find((output) => output.name === source.output)
  return out && out.type.kind === 'value' ? { source, type: out.type } : undefined
}

/** Stored value or default; invalid is a GraphError on the node */
export function readStoredValue(node: CompiledNode, socket: Socket): unknown {
  const raw = node.values[socket.name] ?? socket.default
  if (!socket.type.check(raw)) throw new GraphError(`${socket.label || socket.name} is ${JSON.stringify(raw)}, not a valid ${socket.type.label}`, node.id)
  return raw
}

export const findLinkedUniform = (ctx: CompileContext, source: LinkSource): ProgramUniform | undefined =>
  ctx.uniforms.find((uniform) => uniform.node === source.id && uniform.output === source.output)
