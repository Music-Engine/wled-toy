// Body emission, shared by every target: each node of one pass runs its body once, in topo order, with its inputs
// cast to what the socket takes. A target only says how its language spells a value type and a global state slot.
import type { GlslChunk, NodeContext } from '@/lib/graph/define/context'
import type { Socket } from '@/lib/graph/define/shape'
import type { DataType } from '@/lib/graph/define/types'
import { castTo, componentCount, vectorType, type Value } from '@/lib/graph/define/value'
import { fallsBackToImplicit } from '@/lib/graph/registry'
import type { glslForm } from '@/lib/graph/compile/glsl/glsl-types'
import { concreteType, GraphError } from '@/lib/graph/compile/front-end/program'
import type { CompileContext, CompiledNode, Pass } from './context'
import { isGenericSocket, storedValue } from './sockets'

export interface Spelling {
  /** A value type as the target writes it: its type name, a literal of it, a value cast to it. */
  form(type: DataType<any>): ReturnType<typeof glslForm>
  /** The `dim` floats of global state from `offset` on, as the given pass reads and writes them. */
  globalSlot(offset: number, dim: number, pass: Pass): string
}

export interface PassCode {
  lines: { text: string; node: string }[]
  /** The chunks the pass's bodies included, in the order they first did. */
  chunks: Set<GlslChunk>
  /** Nodes whose body declared through `ctx.require` that it needs GLSL. */
  glslOnly: string[]
}

export function emitPass(ctx: CompileContext, spelling: Spelling, pass: Pass): PassCode {
  const code: PassCode = { lines: [], chunks: new Set(), glslOnly: [] }
  const values = new Map<string, Record<string, Value>>()
  for (const id of ctx.order.filter((id) => ctx.nodes[id].pass === pass)) {
    const node = ctx.nodes[id]
    const body = node.shape.body ?? node.shape.pixel
    if (!body) continue
    const input = Object.fromEntries(node.shape.inputs.map((socket) => [socket.name, bodyInput(ctx, spelling, values, node, socket)]))
    node.shape.includes.forEach((chunk) => code.chunks.add(chunk))
    const outputs = body(input, nodeContext(ctx, code, spelling, node))
    values.set(id, outputs)
    for (const [output, offset] of Object.entries(node.exports ?? {})) {
      const value = outputs[output]
      code.lines.push({ node: id, text: `${spelling.globalSlot(offset, componentCount(value.type)!, 'frame')} = ${value.expr};` })
    }
  }
  return code
}

/** A stream or stored value as is; anything linkable cast to the socket's type, or to the node's width when generic. */
function bodyInput(ctx: CompileContext, spelling: Spelling, values: Map<string, Record<string, Value>>, node: CompiledNode, socket: Socket): unknown {
  if (socket.type.kind === 'stream') return node.streams![socket.name]
  if (!socket.linkable) return storedValue(node, socket)
  const form = spelling.form(socket.type)
  const value = linkedValue(ctx, spelling, values, node, socket) ?? unlinkedValue(spelling, node, socket)
  try {
    return castTo(form.cast(value), isGenericSocket(socket) ? vectorType(node.width!) : form.type)
  } catch (err) {
    throw new GraphError(`${node.shape.title}: ${(err as Error).message}`, node.id)
  }
}

/** A link to an output the source does not have falls back as if unlinked; one to a stream is refused. */
function linkedValue(ctx: CompileContext, spelling: Spelling, values: Map<string, Record<string, Value>>, node: CompiledNode, socket: Socket): Value | undefined {
  const source = node.links[socket.name]
  const from = source && ctx.nodes[source.id]
  const out = from && from.shape.outputs.find((o) => o.name === source.output)
  if (!out) return undefined
  if (out.type.kind !== 'value') throw new GraphError(`${socket.label} needs a number or a color, not ${out.type.label}`, node.id)
  if (from.pass !== node.pass) {
    const dim = out.type.id === 'genType' ? from.width! : out.type.dim!
    return { expr: spelling.globalSlot(from.exports![source.output], dim, node.pass!), type: vectorType(dim) }
  }
  const value = values.get(source.id)?.[source.output]
  if (!value) throw new GraphError(`${from.shape.title} did not produce "${source.output}"`, source.id)
  return value
}

/** The socket's implicit expression (`uv.x`, `iTime`) when nothing is stored for it, else its stored literal. */
function unlinkedValue(spelling: Spelling, node: CompiledNode, socket: Socket): Value {
  if (fallsBackToImplicit(node.values, socket)) return { expr: socket.default.expr, type: concreteType(spelling.form(socket.type).type) }
  return spelling.form(socket.type).literal(storedValue(node, socket))
}

function nodeContext(ctx: CompileContext, code: PassCode, spelling: Spelling, node: CompiledNode): NodeContext {
  const { id: nodeId, resolved } = node
  const base = `n_${nodeId.replace(/\W/g, '_')}`
  const variable = (suffix?: string) => (suffix ? `${base}_${suffix}` : base)
  const emit = (text: string) => code.lines.push({ text, node: nodeId })
  return {
    nodeId, variable, emit,
    resolved: resolved?.data ?? {},
    gen: vectorType(node.width!),
    state: stateSlots(spelling, node),
    declare: (type, expr, suffix) => {
      emit(`${type} ${variable(suffix)} = ${expr};`)
      return { expr: variable(suffix), type }
    },
    call: (fn, args, outs) => {
      const results = Object.entries(outs).map(([name, type]) => [name, { expr: variable(name), type }] as const)
      emit(`${results.map(([, out]) => `${out.type} ${out.expr};`).join(' ')} ${fn}(${[...args, ...results.map(([, out]) => out.expr)].join(', ')});`)
      return Object.fromEntries(results) as never
    },
    include: (chunk) => code.chunks.add(chunk),
    issue: (message) => ctx.issues.push({ nodeId, message }),
    require: () => {
      if (!code.glslOnly.includes(nodeId)) code.glslOnly.push(nodeId)
    },
  }
}

/**
 * A slot is an lvalue holding last frame's value until the body assigns it: per frame, components of global state; per
 * pixel, components of the render target `outState<layer>`, which the usermod target rewrites as the old backend does.
 */
function stateSlots(spelling: Spelling, node: CompiledNode): Record<string, Value> {
  return Object.fromEntries(Object.entries(node.state ?? {}).map(([name, offset]) => {
    const dim = node.shape.state![name].dim!
    const first = offset % 4
    const expr = node.pass === 'pixel' ? `outState${Math.floor(offset / 4) + 1}.${'xyzw'.slice(first, first + dim)}` : spelling.globalSlot(offset, dim, 'frame')
    return [name, { expr, type: vectorType(dim) }]
  }))
}
