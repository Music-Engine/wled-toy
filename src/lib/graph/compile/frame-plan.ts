// The per-frame side of the Program: which nodes are evaluated once per frame, in what order, and with which inputs.
import type { NodeShape, Socket } from '@/lib/graph/define/shape'
import { componentCount } from '@/lib/graph/define/value'
import type { GraphNodeData } from '@/lib/graph/model/doc'
import { fallsBackToImplicit, valueInputs } from '@/lib/graph/registry'
import type { FrameBinding } from './frame'
import { isGenericSocket, slotTypes, storedValue, type FrontEnd } from './front-end'
import { GraphError } from './program'
import { settledStreams } from './streams'

/** Adds the node (and what feeds it) to the frame steps; returns its step index. */
export function planStep(c: FrontEnd, id: string): number {
  const planned = c.steps.get(id)
  if (planned !== undefined) return planned
  const { node, shape } = c.lookup(id)
  const inputs = c.guard(c.visiting, id, () => {
    const inputs: Record<string, FrameBinding> = {}
    for (const [name, constant] of Object.entries(settledStreams(c, id, shape))) inputs[name] = { constant }
    for (const socket of shape.inputs.filter((socket) => socket.type.kind !== 'stream')) {
      inputs[socket.name] = socket.linkable ? linkedBinding(c, id, node.data, socket) : { constant: storedValue(id, node.data, socket) }
    }
    return inputs
  })
  const gen = componentCount(c.widths.get(id)!)!
  c.dims.set(id, outputDims(shape, gen))
  c.record(id)
  // a node with pixel-scope state has no frame body, so it never gets here
  if (shape.state) c.program.state[id] = { scope: 'frame', slots: slotTypes(shape.state) }
  const index = c.program.frame.push({ nodeId: id, inputs, dims: inputDims(shape, gen) }) - 1
  c.steps.set(id, index)
  return index
}

function linkedBinding(c: FrontEnd, id: string, data: GraphNodeData, socket: Socket): FrameBinding {
  const source = c.linkSource(id, socket)
  if (source && c.changesPerPixel.has(source.id)) {
    throw new GraphError(`${socket.label} needs one value per frame, but ${c.lookup(source.id).shape.title} changes per pixel`, id)
  }
  if (source) return { step: planStep(c, source.id), output: source.output }
  if (!fallsBackToImplicit(data.values, socket)) return { constant: storedValue(id, data, socket) }
  if (socket.default.frame) return { frame: socket.default.frame }
  throw new GraphError(`${socket.label} needs a value or a link; its default (${socket.default.label}) only exists per pixel`, id)
}

/** Component count each linked input is cast to before `frame` sees it; generic sockets come last, as planning always listed them. */
function inputDims(shape: NodeShape, gen: number): Record<string, number> {
  const dims: Record<string, number> = {}
  for (const socket of valueInputs(shape)) {
    if (!isGenericSocket(socket)) dims[socket.name] = socket.type.dim ?? 1
  }
  for (const socket of shape.inputs.filter(isGenericSocket)) dims[socket.name] = gen
  return dims
}

/** Components per numeric output; stream outputs are not numbers and never reach the uniform block. */
function outputDims(shape: NodeShape, gen: number): Record<string, number> {
  const dims: Record<string, number> = {}
  for (const out of shape.outputs) {
    if (out.type.kind !== 'value') continue
    dims[out.name] = out.type.id === 'genType' ? gen : out.type.dim ?? 1
  }
  return dims
}
