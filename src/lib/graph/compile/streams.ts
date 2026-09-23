// Streams (Audio, Spectrum) are settled while compiling: a node's `resolve` says what its stream outputs carry,
// given its stored values and the streams linked into it. Numbers linked into it are not known yet and are left out.
import type { ResolveEnv } from '@/lib/graph/define/context'
import type { NodeShape, Socket } from '@/lib/graph/define/shape'
import { canCast } from '@/lib/graph/define/types'
import type { FrontEnd } from './front-end'
import { GraphError } from './program'

export function resolveNode(c: FrontEnd, id: string): Record<string, unknown> {
  const known = c.resolved.get(id)
  if (known) return known
  const { node, shape } = c.lookup(id)
  if (!shape.resolve) return {}
  if (c.resolving.has(id)) throw new GraphError('The graph has a loop. Remove one of the links in the cycle.', id)
  c.resolving.add(id)
  const input: Record<string, unknown> = {}
  for (const socket of shape.inputs) {
    if (socket.type.kind === 'stream') {
      input[socket.name] = streamInput(c, id, socket)
      continue
    }
    if (!socket.linkable) input[socket.name] = c.storedValue(id, node.data, socket)
  }
  const result = shape.resolve(input, resolveEnv(c, id))
  c.resolving.delete(id)
  c.resolved.set(id, result)
  return result
}

function resolveEnv(c: FrontEnd, id: string): ResolveEnv {
  return {
    intern: (kind, config) => {
      const list = (c.program.resources[kind] ??= [])
      const key = JSON.stringify(config)
      const index = list.findIndex((other) => JSON.stringify(other) === key)
      return index >= 0 ? index : list.push(config) - 1
    },
    issue: (message) => c.program.issues.push({ nodeId: id, message }),
  }
}

/** What arrives on a stream input: the linked node's stream, or null when nothing is linked. */
function streamInput(c: FrontEnd, nodeId: string, socket: Socket): unknown {
  const source = c.linkSource(nodeId, socket)
  if (!source) return null
  const from = c.lookup(source.id).shape.outputs.find((out) => out.name === source.output)
  if (!from || !canCast(from.type, socket.type)) throw new GraphError(`${socket.label} needs ${socket.type.label}, not ${from?.type.label ?? 'a missing output'}`, nodeId)
  return resolveNode(c, source.id)[source.output] ?? null
}

/** Inputs that do not depend on where the node runs: streams, and whatever else `resolve` hands on. */
export function settledInputs(c: FrontEnd, id: string, shape: NodeShape): Record<string, unknown> {
  const streams = Object.fromEntries(shape.inputs.filter((socket) => socket.type.kind === 'stream').map((socket) => [socket.name, streamInput(c, id, socket)]))
  const outputs = new Set(shape.outputs.map((out) => out.name))
  const extras = Object.fromEntries(Object.entries(resolveNode(c, id)).filter(([name]) => !outputs.has(name)))
  return { ...streams, ...extras }
}
