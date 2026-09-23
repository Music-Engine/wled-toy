// Streams (Audio, Spectrum) are settled while compiling: a node's `resolve` says what its stream outputs carry,
// given its stored values and the streams linked into it. Numbers linked into it are not known yet and are left out.
import { resourceIndex, type ResolveResult } from '@/lib/graph/define/context'
import type { NodeShape, Socket } from '@/lib/graph/define/shape'
import { canCast } from '@/lib/graph/define/types'
import type { GraphNodeData } from '@/lib/graph/model/doc'
import { storedValue, type FrontEnd } from './front-end'
import { GraphError } from './program'

export function resolveNode(c: FrontEnd, id: string): ResolveResult {
  const known = c.resolved.get(id)
  if (known) return known
  const { node, shape } = c.lookup(id)
  if (!shape.resolve) return {}
  if (c.resolving.has(id)) throw new GraphError('The graph has a loop. Remove one of the links in the cycle.', id)
  c.resolving.add(id)
  const result = shape.resolve(resolveInput(c, id, node.data, shape), c.program.resources)
  register(c, id, result)
  c.resolving.delete(id)
  c.resolved.set(id, result)
  return result
}

function resolveInput(c: FrontEnd, id: string, data: GraphNodeData, shape: NodeShape): Record<string, unknown> {
  const input: Record<string, unknown> = {}
  for (const socket of shape.inputs) {
    if (socket.type.kind === 'stream') {
      input[socket.name] = streamInput(c, id, socket)
      continue
    }
    if (!socket.linkable) input[socket.name] = storedValue(id, data, socket)
  }
  return input
}

function register(c: FrontEnd, id: string, { requires = [], issues = [] }: ResolveResult): void {
  const { resources } = c.program
  for (const { kind, config } of requires) {
    const list = (resources[kind] ??= [])
    if (resourceIndex(resources, kind, config) === list.length) list.push(config)
  }
  for (const message of issues) c.program.issues.push({ nodeId: id, message })
}

/** What arrives on a stream input: the linked node's stream, or null when nothing is linked. */
function streamInput(c: FrontEnd, nodeId: string, socket: Socket): unknown {
  const source = c.linkSource(nodeId, socket)
  if (!source) return null
  const from = c.lookup(source.id).shape.outputs.find((out) => out.name === source.output)
  if (!from || !canCast(from.type, socket.type)) throw new GraphError(`${socket.label} needs ${socket.type.label}, not ${from?.type.label ?? 'a missing output'}`, nodeId)
  return resolveNode(c, source.id).streams?.[source.output] ?? null
}

/** Settles the node's own `resolve`, and returns what arrives on its stream inputs. */
export function settledStreams(c: FrontEnd, id: string, shape: NodeShape): Record<string, unknown> {
  const streams = Object.fromEntries(shape.inputs.filter((socket) => socket.type.kind === 'stream').map((socket) => [socket.name, streamInput(c, id, socket)]))
  resolveNode(c, id)
  return streams
}
