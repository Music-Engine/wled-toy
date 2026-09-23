// What every compile stage reads and writes: the graph, the code being built, the per-frame plan, and the issues found.
import type { OutputSettings } from '@/lib/engine/output'
import type { GlslType } from '@/lib/shader/glsl'
import type { FrameValue, GlslChunk } from '@/lib/graph/define/context'
import { isImplicit, isLinkable, type InputSocket, type NodeShape } from '@/lib/graph/define/shape'
import { itemFor } from '@/lib/graph/registry'
import type { Value } from '@/lib/graph/define/value'
import type { NodeGraph, GraphNodeData, StoredNode } from '@/lib/graph/model/doc'
import type { FramePlan } from './frame'

export interface GraphIssue {
  nodeId: string | null
  message: string
}

export interface FrozenValue {
  nodeId: string
  title: string
  output: string
  value: string
}

export interface CompileOptions {
  /**
   * Compile for shader mode or an exported .glsl file, where nothing feeds the uniform block: every node with GLSL
   * runs in the shader, per-frame-only nodes use their `standalone` GLSL or are baked from `controls` as literals.
   */
  standalone?: boolean
  /** The last value a per-frame node produced, for baking. */
  controls?: (nodeId: string, output: string) => FrameValue | undefined
}

export class GraphError extends Error {
  constructor(message: string, readonly nodeId: string) {
    super(message)
  }
}

export const isGenericSocket = (socket: InputSocket) => isLinkable(socket) && socket.type.glsl === 'genType'

/** The value stored on the node for a socket, or its default; an invalid value is replaced and `valid` says so. */
export function storedOrDefault(data: GraphNodeData, socket: InputSocket): { value: unknown; valid: boolean } {
  const raw = data.values[socket.name] ?? socket.default
  if (socket.type.check(raw)) return { value: raw, valid: true }
  return { value: isImplicit(socket.default) ? socket.type.initial() : socket.default, valid: false }
}

export class Compilation {
  readonly nodes: Map<string, StoredNode>
  readonly body: { text: string; node: string }[] = []
  readonly issues: GraphIssue[] = []
  readonly frozen: FrozenValue[] = []
  readonly chunks = new Set<GlslChunk>()
  readonly plan: FramePlan = { steps: [], exports: [], resources: {} }
  output: OutputSettings | null = null
  /** Nodes on the current evaluation path, for loop detection. */
  readonly visiting = new Set<string>()

  // per stage, by node id: what ./streams settled
  readonly resolved = new Map<string, Record<string, unknown>>()
  readonly resolving = new Set<string>()
  // what ./width inferred
  readonly widths = new Map<string, GlslType>()
  // what ./control-plan decided
  readonly capable = new Map<string, boolean>()
  readonly steps = new Map<string, number>()
  readonly dims = new Map<string, Record<string, number>>()
  readonly exported = new Map<string, Value>()
  nextSlot = 0
  // what ./emit produced
  readonly emitted = new Map<string, Record<string, Value>>()

  private readonly incoming: Map<string, NodeGraph['edges'][number]>
  private readonly shapes = new Map<string, NodeShape>()

  constructor(readonly doc: NodeGraph, readonly options: CompileOptions) {
    this.nodes = new Map(doc.nodes.map((n) => [n.id, n]))
    this.incoming = new Map(doc.edges.map((e) => [`${e.target}:${e.targetHandle}`, e]))
  }

  get standalone() {
    return this.options.standalone === true
  }

  /** The node and the shape its values give it, settled once per node. */
  lookup(id: string): { node: StoredNode; shape: NodeShape } {
    const node = this.nodes.get(id)!
    let shape = this.shapes.get(id)
    if (!shape) {
      const kind = itemFor(node.data.kind)
      if (!kind) throw new GraphError(`Unknown node type "${node.data.kind}"`, id)
      shape = kind.shape(node.data.values)
      this.shapes.set(id, shape)
    }
    return { node, shape }
  }

  enter(id: string) {
    if (this.visiting.has(id)) throw new GraphError('The graph has a loop. Remove one of the links in the cycle.', id)
    this.visiting.add(id)
  }

  leave(id: string) {
    this.visiting.delete(id)
  }

  /** Where a socket's link comes from, when it has one and the source node exists. */
  linkSource(nodeId: string, socket: InputSocket): { id: string; output: string } | undefined {
    const edge = this.incoming.get(`${nodeId}:${socket.name}`)
    return edge?.sourceHandle && this.nodes.has(edge.source) ? { id: edge.source, output: edge.sourceHandle } : undefined
  }

  /** The value stored on the node for a socket, or its default; an invalid value is reported and replaced. */
  storedValue(nodeId: string, data: GraphNodeData, socket: InputSocket): unknown {
    const { value, valid } = storedOrDefault(data, socket)
    if (!valid) this.issues.push({ nodeId, message: `${socket.label || socket.type.label} is not valid; the default is used` })
    return value
  }

  emit(nodeId: string, text: string) {
    this.body.push({ text, node: nodeId })
  }
}
