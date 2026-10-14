import type { Socket } from '@/lib/graph/define/shape'
import { canCast } from '@/lib/graph/define/types'
import { findResourceIndex, type ResolveResult } from '@/lib/graph/define/context'
import type { Annotation, CompileContext, CompiledNode } from '@/lib/graph/compile/context'
import { readStoredValue } from '@/lib/graph/compile/sockets'

/** Runs `resolve` in topo order, so stream sources resolve first and uniforms number in order */
export const resolveResources = (): Annotation => ({
  name: 'resources',
  reads: [],
  annotate: (ctx) => {
    for (const id of ctx.order) resolveNode(ctx, ctx.nodes[id])
  },
})

function resolveNode(ctx: CompileContext, node: CompiledNode): void {
  const { shape } = node
  node.streams = Object.fromEntries(
    shape.inputs.filter((socket) => socket.type.kind === 'stream').map((socket) => [socket.name, readStreamInput(ctx, node, socket)]),
  )
  if (!shape.resolve) {
    node.resolved = {}
    return
  }
  const stored = shape.inputs.filter((socket) => !socket.linkable).map((socket) => [socket.name, readStoredValue(node, socket)])
  node.resolved = shape.resolve({ ...node.streams, ...Object.fromEntries(stored) }, ctx.resources)
  register(ctx, node.id, node.resolved)
  for (const [output, uniform] of Object.entries(node.resolved.uniforms ?? {}))
    ctx.uniforms.push({ ...uniform, node: node.id, output, offset: ctx.uniforms.length })
  if (node.id === ctx.output) ctx.settings = node.resolved.output ?? null
}

/** Equal configs share one entry, so the index matches what `findResourceIndex` gave while resolving */
function register(ctx: CompileContext, id: string, { requires = [], issues = [] }: ResolveResult): void {
  for (const { kind, config } of requires) {
    const list = (ctx.resources[kind] ??= [])
    if (findResourceIndex(ctx.resources, kind, config) === list.length) list.push(config)
  }
  for (const message of issues) ctx.issues.push({ nodeId: id, message })
}

/** Linked node's stream; null when unlinked or of another type, which `checkLinkTypes` reports */
function readStreamInput(ctx: CompileContext, node: CompiledNode, socket: Socket): unknown {
  const source = node.links[socket.name]
  const from = source && ctx.nodes[source.id].shape.outputs.find((out) => out.name === source.output)
  if (!from || !canCast(from.type, socket.type)) return null
  return ctx.nodes[source.id].resolved!.streams?.[source.output] ?? null
}
