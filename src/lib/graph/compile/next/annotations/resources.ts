// What each node's `resolve` settles while compiling: what its stream outputs carry, the data its body gets, what the
// engine has to provide, the uniforms its outputs read and what is wrong. Topo order resolves every stream source
// before the nodes it feeds, and numbers the uniforms.
import { CONTROL_VECTORS } from '@/lib/shader/prelude'
import type { Socket } from '@/lib/graph/define/shape'
import { canCast } from '@/lib/graph/define/types'
import { resourceIndex, type ResolveResult } from '@/lib/graph/define/context'
import { GraphError } from '@/lib/graph/compile/front-end/program'
import type { Annotation, CompileContext, CompiledNode } from '@/lib/graph/compile/next/context'
import { storedValue } from '@/lib/graph/compile/next/sockets'

export const resources = (): Annotation => ({
  name: 'resources',
  reads: [],
  annotate: (ctx) => {
    for (const id of ctx.order) resolveNode(ctx, ctx.nodes[id])
  },
})

function resolveNode(ctx: CompileContext, node: CompiledNode): void {
  const { shape } = node
  node.streams = Object.fromEntries(shape.inputs.filter((s) => s.type.kind === 'stream').map((s) => [s.name, streamInput(ctx, node, s)]))
  if (!shape.resolve) {
    node.resolved = {}
    return
  }
  const stored = shape.inputs.filter((s) => !s.linkable).map((s) => [s.name, storedValue(node, s)])
  node.resolved = shape.resolve({ ...node.streams, ...Object.fromEntries(stored) }, ctx.resources)
  register(ctx, node.id, node.resolved)
  for (const [output, uniform] of Object.entries(node.resolved.uniforms ?? {})) {
    if (ctx.uniforms.length === CONTROL_VECTORS * 4) throw new GraphError('Too many knobs, MIDI and OSC values reach the shader', node.id)
    ctx.uniforms.push({ ...uniform, node: node.id, output, offset: ctx.uniforms.length })
  }
  if (node.id === ctx.output) ctx.settings = node.resolved.output ?? null
}

/** Equal configs share one entry, so a node's index is the one `resourceIndex` gave it while resolving. */
function register(ctx: CompileContext, id: string, { requires = [], issues = [] }: ResolveResult): void {
  for (const { kind, config } of requires) {
    const list = (ctx.resources[kind] ??= [])
    if (resourceIndex(ctx.resources, kind, config) === list.length) list.push(config)
  }
  for (const message of issues) ctx.issues.push({ nodeId: id, message })
}

/** What arrives on a stream input: the linked node's stream, or null when nothing is linked. */
function streamInput(ctx: CompileContext, node: CompiledNode, socket: Socket): unknown {
  const source = node.links[socket.name]
  if (!source) return null
  const from = ctx.nodes[source.id].shape.outputs.find((out) => out.name === source.output)
  if (!from || !canCast(from.type, socket.type)) throw new GraphError(`${socket.label} needs ${socket.type.label}, not ${from?.type.label ?? 'a missing output'}`, node.id)
  return ctx.nodes[source.id].resolved!.streams?.[source.output] ?? null
}
