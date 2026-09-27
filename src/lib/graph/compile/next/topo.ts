// The topo sort: from the sinks, depth first in document order and each input in declaration order, a node after
// everything it reads. That is the order the old pipeline emitted in, so a pixel pass can match it line for line.
import { canCast } from '@/lib/graph/define/types'
import { edgesByInput, inputKey, type NodeGraph, type StoredNode } from '@/lib/graph/model/doc'
import { nodeItem } from '@/lib/graph/registry'
import { GraphError } from '@/lib/graph/compile/front-end/program'
import type { CompileContext, CompiledNode, LinkSource } from './context'

/**
 * Fills `order`, `nodes` and `output`; false, with an issue, when there is no Output. A loop or an unknown kind on the
 * way is an error on that node.
 */
export function topoSort(ctx: CompileContext): boolean {
  const graph = new Graph(ctx.doc)
  const sinks = ctx.doc.nodes.filter((n) => nodeItem(n.data.kind)?.base.isOutput).map((n) => n.id)
  const [output, ...others] = sinks.filter((id) => graph.node(id).shape.varies === 'pixel')
  if (!output) {
    ctx.issues.push({ nodeId: null, message: 'Add an Output node to see anything.' })
    return false
  }
  for (const id of others) ctx.issues.push({ nodeId: id, message: `Only the first Output ("${output}") drives the LEDs; this one is left out` })
  ctx.output = output
  const visiting = new Set<string>()
  for (const id of sinks.filter((id) => !others.includes(id))) visit(ctx, graph, id, visiting)
  return true
}

function visit(ctx: CompileContext, graph: Graph, id: string, visiting: Set<string>): void {
  if (ctx.nodes[id]) return
  if (visiting.has(id)) throw new GraphError('The graph has a loop. Remove one of the links in the cycle.', id)
  visiting.add(id)
  const node = graph.node(id)
  for (const source of Object.values(node.links)) visit(ctx, graph, source.id, visiting)
  visiting.delete(id)
  ctx.nodes[id] = node
  ctx.order.push(id)
}

class Graph {
  private readonly stored: Map<string, StoredNode>
  private readonly incoming: Map<string, NodeGraph['edges'][number]>
  private readonly built = new Map<string, CompiledNode>()

  constructor(doc: NodeGraph) {
    this.stored = new Map(doc.nodes.map((n) => [n.id, n]))
    this.incoming = edgesByInput(doc.edges)
  }

  /** The node at its stored values, with the source of each linked input. */
  node(id: string): CompiledNode {
    const known = this.built.get(id)
    if (known) return known
    const { data } = this.stored.get(id)!
    const registered = nodeItem(data.kind)
    if (!registered) throw new GraphError(`Unknown node type "${data.kind}"`, id)
    const node: CompiledNode = { id, kind: data.kind, values: data.values, shape: registered.shape(data.values), links: {} }
    this.built.set(id, node)
    for (const socket of node.shape.inputs.filter((s) => s.linkable)) {
      const source = this.direct(id, socket.name)
      const passed = source && this.unmuted(source, new Set())
      if (passed) node.links[socket.name] = passed
    }
    return node
  }

  private direct(id: string, input: string): LinkSource | undefined {
    const edge = this.incoming.get(inputKey(id, input))
    return edge?.sourceHandle && this.stored.has(edge.source) ? { id: edge.source, output: edge.sourceHandle } : undefined
  }

  /**
   * Blender's mute: a muted node's output reads its first linked input whose value casts to that output, and with none
   * the consumer falls back as if unlinked.
   */
  private unmuted(source: LinkSource, path: Set<string>): LinkSource | undefined {
    if (!this.stored.get(source.id)!.data.muted) return source
    if (path.has(source.id)) throw new GraphError('The graph has a loop. Remove one of the links in the cycle.', source.id)
    path.add(source.id)
    const passed = this.passedThrough(source, path)
    path.delete(source.id)
    return passed
  }

  private passedThrough(source: LinkSource, path: Set<string>): LinkSource | undefined {
    const { shape } = this.node(source.id)
    const output = shape.outputs.find((o) => o.name === source.output)
    if (!output) return undefined
    for (const socket of shape.inputs.filter((s) => s.linkable)) {
      const upstream = this.direct(source.id, socket.name)
      const passed = upstream && this.unmuted(upstream, path)
      const type = passed && this.outputType(passed)
      if (type && canCast(type, output.type)) return passed
    }
    return undefined
  }

  private outputType({ id, output }: LinkSource) {
    return this.node(id).shape.outputs.find((o) => o.name === output)?.type
  }
}
