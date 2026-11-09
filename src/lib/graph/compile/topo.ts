import { canCast } from '@/lib/graph/define/types'
import { edgesByInput, inputKey, type NodeGraph, type StoredNode } from '@/lib/graph/model/doc'
import { findNodeItem } from '@/lib/graph/registry'
import { GraphError, type CompileContext, type CompiledNode, type LinkSource } from './context'

/**
 * Depth first from the sinks in doc order, inputs in declaration order, so every value is declared before read;
 * false w/ an issue when there's no Output; loop or unknown kind is a GraphError on the node
 */
export function topoSort(ctx: CompileContext): boolean {
  const graph = new Graph(ctx.doc)
  const sinks = ctx.doc.nodes.filter((node) => findNodeItem(node.data.kind)?.base.isOutput).map((node) => node.id)
  const [output, ...others] = sinks.filter((id) => graph.readNode(id).shape.varies === 'pixel')
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
  const node = graph.readNode(id)
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
    this.stored = new Map(doc.nodes.map((node) => [node.id, node]))
    this.incoming = edgesByInput(doc.edges)
  }

  /** Node at its stored values w/ each linked input's source */
  readNode(id: string): CompiledNode {
    const known = this.built.get(id)
    if (known) return known
    const { data } = this.stored.get(id)!
    const registered = findNodeItem(data.kind)
    if (!registered) throw new GraphError(`Unknown node type "${data.kind}"`, id)
    const node: CompiledNode = { id, kind: data.kind, values: data.values, shape: registered.shape(data.values), links: {} }
    this.built.set(id, node)
    for (const socket of node.shape.inputs.filter((socket) => socket.linkable)) {
      const source = this.findDirectSource(id, socket.name)
      const passed = source && this.unmute(source, new Set())
      if (passed) node.links[socket.name] = passed
    }
    return node
  }

  private findDirectSource(id: string, input: string): LinkSource | undefined {
    const edge = this.incoming.get(inputKey(id, input))
    return edge?.sourceHandle && this.stored.has(edge.source) ? { id: edge.source, output: edge.sourceHandle } : undefined
  }

  /** Blender's mute: output reads the first linked input that casts to it; with none, consumer reads as unlinked */
  private unmute(source: LinkSource, path: Set<string>): LinkSource | undefined {
    if (!this.stored.get(source.id)!.data.muted) return source
    if (path.has(source.id)) throw new GraphError('The graph has a loop. Remove one of the links in the cycle.', source.id)
    path.add(source.id)
    const passed = this.passThrough(source, path)
    path.delete(source.id)
    return passed
  }

  private passThrough(source: LinkSource, path: Set<string>): LinkSource | undefined {
    const { shape } = this.readNode(source.id)
    const output = shape.outputs.find((socket) => socket.name === source.output)
    if (!output) return undefined
    for (const socket of shape.inputs.filter((socket) => socket.linkable)) {
      const upstream = this.findDirectSource(source.id, socket.name)
      const passed = upstream && this.unmute(upstream, path)
      const type = passed && this.findOutputType(passed)
      if (type && canCast(type, output.type)) return passed
    }
    return undefined
  }

  private findOutputType({ id, output }: LinkSource) {
    return this.readNode(id).shape.outputs.find((socket) => socket.name === output)?.type
  }
}
