// Generic widths: before anything is emitted, each node's `gen` type is settled from the widest type linked or stored
// on its generic sockets, walking from the sinks in the order emission and planning will.
import type { GlslType } from '@/lib/shader/glsl'
import type { Socket } from '@/lib/graph/define/shape'
import { componentCount, vectorType } from '@/lib/graph/define/value'
import type { GraphNodeData } from '@/lib/graph/model/doc'
import { fallsBackToImplicit, valueInputs } from '@/lib/graph/registry'
import { isGenericSocket, storedOrDefault, type FrontEnd } from './front-end'
import { glslForm, standaloneExpr } from './glsl'

type Rate = 'pixel' | 'frame'
type Link = { id: string; output: string }

/** Fills `c.widths` for every node the sinks reach, sources before the nodes they feed. */
export function inferWidths(c: FrontEnd, sinks: string[]): void {
  const trail = new Set<string>()
  for (const id of sinks) {
    const { shape } = c.lookup(id)
    if (shape.exec) inferNode(c, id, 'pixel', trail)
    else if (shape.run) inferNode(c, id, 'frame', trail)
  }
}

function inferNode(c: FrontEnd, id: string, rate: Rate, trail: Set<string>): void {
  // a loop is reported by emission, which walks the same links; no width on it is read before that
  if (c.widths.has(id) || trail.has(id)) return
  trail.add(id)
  const { node, shape } = c.lookup(id)
  for (const socket of valueInputs(shape)) {
    const source = c.linkSource(id, socket)
    if (!source) continue
    const from = sourceRate(c, source.id, rate)
    if (from !== 'baked') inferNode(c, source.id, from, trail)
  }
  const counts = valueInputs(shape).filter(isGenericSocket).map((socket) => componentCount(inputType(c, id, node.data, socket, rate)) ?? 1)
  c.widths.set(id, vectorType(Math.max(1, ...counts)))
}

/** A frame consumer reads a planned step; a pixel consumer reads emitted GLSL, a uniform, or, standalone, a frozen value. */
function sourceRate(c: FrontEnd, id: string, rate: Rate): Rate | 'baked' {
  if (rate === 'frame') return 'frame'
  if (c.placedAt(id) === 'pixel') return 'pixel'
  return c.standalone ? 'baked' : 'frame'
}

/** The type a socket arrives as, before it is cast to the node's width. */
function inputType(c: FrontEnd, id: string, data: GraphNodeData, socket: Socket, rate: Rate): GlslType {
  const source = c.linkSource(id, socket)
  const out = source && c.lookup(source.id).shape.outputs.find((o) => o.name === source.output)
  if (source && out && out.type.kind === 'value') return outputType(c, source, glslForm(out.type).type, sourceRate(c, source.id, rate))
  // planning reads a missing or non-numeric output as one component; emission falls back as if unlinked
  if (source && rate === 'frame') return 'float'
  if (fallsBackToImplicit(data.values, socket)) return 'float'
  return glslForm(socket.type).literal(storedOrDefault(data, socket).value).type
}

function outputType(c: FrontEnd, source: Link, glsl: GlslType, from: Rate | 'baked'): GlslType {
  if (from === 'baked') return bakedType(c, source, glsl)
  // undefined only on a loop, which emission reports
  if (glsl === 'genType') return c.widths.get(source.id) ?? 'float'
  return glsl
}

/** A frozen output is its standalone GLSL, else the literal of its last value. */
function bakedType(c: FrontEnd, { id, output }: Link, glsl: GlslType): GlslType {
  if (standaloneExpr(c.lookup(id).node.data.kind, output)) return glsl === 'genType' ? 'float' : glsl
  const value = c.options.controls?.(id, output) ?? 0
  return Array.isArray(value) ? vectorType(value.length) : 'float'
}
