// What the stages ask of one input socket: whether it is generic, what is linked into it, what is stored on it.
import type { Socket } from '@/lib/graph/define/shape'
import type { DataType } from '@/lib/graph/define/types'
import { GraphError } from '@/lib/graph/compile/front-end/program'
import type { CompileContext, CompiledNode, LinkSource, ProgramUniform } from './context'

export const isGenericSocket = (socket: Socket) => socket.linkable && socket.type.id === 'genType'

/**
 * The number or vector output linked into the socket. A link to an output the source does not have, or to a stream,
 * reads as unlinked here; emission refuses the stream.
 */
export function linkedOutput(ctx: CompileContext, node: CompiledNode, socket: Socket): { source: LinkSource; type: DataType<any> } | undefined {
  const source = node.links[socket.name]
  const out = source && ctx.nodes[source.id].shape.outputs.find((o) => o.name === source.output)
  return out && out.type.kind === 'value' ? { source, type: out.type } : undefined
}

/** The value stored on the node for a socket, or its default; an invalid one is an error on the node. */
export function storedValue(node: CompiledNode, socket: Socket): unknown {
  const raw = node.values[socket.name] ?? socket.default
  if (!socket.type.check(raw)) throw new GraphError(`${socket.label || socket.name} is ${JSON.stringify(raw)}, not a valid ${socket.type.label}`, node.id)
  return raw
}

/** The uniform a linked output reads, if it reads one. */
export const linkedUniform = (ctx: CompileContext, source: LinkSource): ProgramUniform | undefined =>
  ctx.uniforms.find((uniform) => uniform.node === source.id && uniform.output === source.output)
