// The per-pixel side of the Program: which nodes the shader emits, in the order it emits them, and where each of their
// inputs comes from.
import type { Socket } from '@/lib/graph/define/shape'
import type { GraphNodeData } from '@/lib/graph/model/doc'
import { fallsBackToImplicit } from '@/lib/graph/registry'
import { isGenericSocket, storedValue, type FrontEnd } from './front-end'
import { glslForm } from './glsl'
import { GraphError, type PixelInput, type PixelSource } from './program'
import { settledStreams } from './streams'
import { perFrameSource } from './uniforms'

/** Lists the node after everything it reads, so the shader emits it once its inputs exist. Only for nodes with GLSL. */
export function emitPixel(c: FrontEnd, id: string): void {
  if (c.emitted.has(id)) return
  const { node, shape } = c.lookup(id)
  if (!shape.pixel) throw new GraphError(`${shape.title} runs once per frame and cannot be drawn directly`, id)
  c.enter(id)
  const settled = settledStreams(c, id, shape)
  const inputs = Object.fromEntries(shape.inputs.map((socket) => [socket.name, pixelInput(c, id, node.data, settled, socket)]))
  c.leave(id)
  c.emitted.add(id)
  c.record(id)
  c.program.pixel.push({ node: id, inputs })
}

/** What `pixel` gets on a socket: the settled stream, the stored value, or a linkable value cast to the socket's type. */
function pixelInput(c: FrontEnd, id: string, data: GraphNodeData, settled: Record<string, unknown>, socket: Socket): PixelInput {
  if (socket.type.kind === 'stream') return { value: settled[socket.name] }
  if (!socket.linkable) return { value: storedValue(id, data, socket) }
  const from = linkedSource(c, id, data, socket)
  return { from, cast: isGenericSocket(socket) ? c.widths.get(id)! : glslForm(socket.type).type }
}

/** From the link, else the socket's implicit expression, else its stored literal. */
function linkedSource(c: FrontEnd, nodeId: string, data: GraphNodeData, socket: Socket): PixelSource {
  const source = c.linkSource(nodeId, socket)
  const out = source && c.lookup(source.id).shape.outputs.find((o) => o.name === source.output)
  if (out && out.type.kind !== 'value') throw new GraphError(`${socket.label} needs a number or a color, not ${out.type.label}`, nodeId)
  const linked = source && readSource(c, source.id, source.output)
  if (linked) return linked
  if (fallsBackToImplicit(data.values, socket)) return { implicit: true }
  return { literal: storedValue(nodeId, data, socket) }
}

/** A link to an output the node does not have still runs the node, and the socket falls back as if unlinked. */
function readSource(c: FrontEnd, id: string, output: string): PixelSource | undefined {
  if (c.placedAt(id) === 'frame') return perFrameSource(c, id, output)
  emitPixel(c, id)
  return c.lookup(id).shape.outputs.some((o) => o.name === output) ? { link: id, output } : undefined
}
