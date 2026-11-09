import type { GlslChunk, NodeContext } from '@/lib/graph/define/context'
import type { Socket } from '@/lib/graph/define/shape'
import type { DataType } from '@/lib/graph/define/types'
import { castTo, componentCount, vectorType, type Value } from '@/lib/graph/define/value'
import { fallsBackToImplicit } from '@/lib/graph/registry'
import type { toGlslForm } from '@/lib/graph/compile/targets/glsl-form'
import { GraphError, type CompileContext, type CompiledNode, type Pass, type PassCode, type ProgramUniform } from './context'
import { isGenericSocket, findLinkedUniform, readStoredValue } from './sockets'

/** Each body of one pass (or `both` in one function, no exports) once, in topo order, inputs cast to the socket's type */
export function emitPass(ctx: CompileContext, spelling: Spelling, pass: Pass | 'both'): PassCode {
  const code: PassCode = { lines: [], includes: [] }
  const values = new Map<string, Record<string, Value>>()
  for (const id of ctx.order.filter((id) => pass === 'both' || ctx.nodes[id].pass === pass)) {
    const node = ctx.nodes[id]
    const { body } = node.shape
    if (!body) continue
    const input = Object.fromEntries(node.shape.inputs.map((socket) => [socket.name, readBodyInput(ctx, spelling, values, node, socket, pass === 'both')]))
    node.shape.includes.forEach((chunk) => code.includes.push({ chunk, node: id }))
    const outputs = body(input, createNodeContext(ctx, code, spelling, node))
    values.set(id, outputs)
    if (pass !== 'both') writeExports(code, spelling, node, outputs)
  }
  return code
}

/** How a target spells what emission writes */
export interface Spelling {
  toForm(type: DataType<any>): ReturnType<typeof toGlslForm>
  /** `dim` floats of global state from `offset`, as `pass` reads and writes them */
  toGlobalSlot(offset: number, dim: number, pass: Pass): string
  toUniform(uniform: ProgramUniform): string
}

/** Stream or stored value as is; linkable cast to socket type, or node width when generic */
function readBodyInput(
  ctx: CompileContext,
  spelling: Spelling,
  values: Map<string, Record<string, Value>>,
  node: CompiledNode,
  socket: Socket,
  isOnePass: boolean,
): unknown {
  if (socket.type.kind === 'stream') return node.streams![socket.name]
  if (!socket.linkable) return readStoredValue(node, socket)
  const form = spelling.toForm(socket.type)
  const value = readLinkedValue(ctx, spelling, values, node, socket, isOnePass) ?? readUnlinkedValue(spelling, node, socket)
  return castForNode(node, () => castTo(form.cast(value), isGenericSocket(socket) ? vectorType(node.width!) : form.type))
}

/** Link to a missing or stream output reads as unlinked (`checkLinkTypes` refuses the stream); uniform outputs read the uniform wherever linked */
function readLinkedValue(
  ctx: CompileContext,
  spelling: Spelling,
  values: Map<string, Record<string, Value>>,
  node: CompiledNode,
  socket: Socket,
  isOnePass: boolean,
): Value | undefined {
  const source = node.links[socket.name]
  const from = source && ctx.nodes[source.id]
  const out = from && from.shape.outputs.find((output) => output.name === source.output)
  if (!out || out.type.kind !== 'value') return undefined
  const uniform = findLinkedUniform(ctx, source)
  if (uniform) return { expr: spelling.toUniform(uniform), type: 'float' }
  if (!isOnePass && from.pass !== node.pass) {
    const dim = out.type.id === 'genType' ? from.width! : out.type.dim!
    return { expr: spelling.toGlobalSlot(from.exports![source.output], dim, node.pass!), type: vectorType(dim) }
  }
  const value = values.get(source.id)?.[source.output]
  if (!value) throw new GraphError(`${from.shape.title} did not produce "${source.output}"`, source.id)
  return value
}

/** Implicit expression (`uv.x`, `iTime`) when nothing stored, else stored literal */
function readUnlinkedValue(spelling: Spelling, node: CompiledNode, socket: Socket): Value {
  const form = spelling.toForm(socket.type)
  // Unresolved generic declared as float
  if (fallsBackToImplicit(node.values, socket)) return { expr: socket.default.expr, type: form.type === 'genType' ? 'float' : form.type }
  return form.toLiteral(readStoredValue(node, socket))
}

function createNodeContext(ctx: CompileContext, code: PassCode, spelling: Spelling, node: CompiledNode): NodeContext {
  const { id: nodeId, resolved } = node
  const base = `n_${nodeId.replace(/\W/g, '_')}`
  const variable = (suffix?: string) => (suffix ? `${base}_${suffix}` : base)
  const emit = (text: string) => code.lines.push({ text, node: nodeId })
  return {
    nodeId,
    variable,
    emit,
    resolved: resolved?.data ?? {},
    gen: vectorType(node.width!),
    state: toStateSlots(spelling, node),
    declare: (type, expr, suffix) => {
      emit(`${type} ${variable(suffix)} = ${expr};`)
      return { expr: variable(suffix), type }
    },
    call: (name, args, outs) => {
      const results = Object.entries(outs).map(([out, type]) => [out, { expr: variable(out), type }] as const)
      emit(
        `${results.map(([, value]) => `${value.type} ${value.expr};`).join(' ')} ${name}(${[...args, ...results.map(([, value]) => value.expr)].join(', ')});`,
      )
      return Object.fromEntries(results) as never
    },
    include: (chunk) => code.includes.push({ chunk, node: nodeId }),
    issue: (message) => ctx.issues.push({ nodeId, message }),
  }
}

/**
 * Slot = lvalue holding last frame's value until assigned: global state per frame, render target `outState<layer>`
 * per pixel, which the usermod target rewrites into its per-LED array
 */
function toStateSlots(spelling: Spelling, node: CompiledNode): Record<string, Value> {
  return Object.fromEntries(
    Object.entries(node.state ?? {}).map(([name, offset]) => {
      const dim = node.shape.state![name].dim!
      const first = offset % 4
      const expr =
        node.pass === 'pixel' ? `outState${Math.floor(offset / 4) + 1}.${'xyzw'.slice(first, first + dim)}` : spelling.toGlobalSlot(offset, dim, 'frame')
      return [name, { expr, type: vectorType(dim) }]
    }),
  )
}

/** Exported value cast to the declared output type, the type `state` sized its slot by */
function writeExports(code: PassCode, spelling: Spelling, node: CompiledNode, outputs: Record<string, Value>): void {
  for (const [output, offset] of Object.entries(node.exports ?? {})) {
    const { type } = node.shape.outputs.find((socket) => socket.name === output)!
    const value = castForNode(node, () => castTo(outputs[output], type.id === 'genType' ? vectorType(node.width!) : spelling.toForm(type).type))
    code.lines.push({ node: node.id, text: `${spelling.toGlobalSlot(offset, componentCount(value.type)!, 'frame')} = ${value.expr};` })
  }
}

/** A failed cast is a GraphError on the node */
function castForNode(node: CompiledNode, cast: () => Value): Value {
  try {
    return cast()
  } catch (error) {
    throw new GraphError(`${node.shape.title}: ${(error as Error).message}`, node.id)
  }
}

/** Each chunk once, dependencies first */
export function orderChunks(chunks: Iterable<GlslChunk>): GlslChunk[] {
  const ordered: GlslChunk[] = []
  const seen = new Set<GlslChunk>()
  const visit = (chunk: GlslChunk) => {
    if (seen.has(chunk)) return
    seen.add(chunk)
    chunk.requires.forEach(visit)
    ordered.push(chunk)
  }
  for (const chunk of chunks) visit(chunk)
  return ordered
}
