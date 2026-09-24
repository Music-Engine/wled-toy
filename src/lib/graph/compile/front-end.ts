// What the front-end passes share while they build a Program: the graph, loop detection, what each pass settled per
// node, and the Program as far as it is built. The backends never see it.
import type { GlslType } from '@/lib/shader/glsl'
import type { FrameValue, ResolveResult } from '@/lib/graph/define/context'
import type { NodeShape, Rate, Socket } from '@/lib/graph/define/shape'
import { nodeItem, valueInputs } from '@/lib/graph/registry'
import { edgesByInput, inputKey, type NodeGraph, type GraphNodeData, type StoredNode } from '@/lib/graph/model/doc'
import { GraphError, type PixelSource, type Program } from './program'

export interface CompileOptions {
  /**
   * Compile for shader mode or an exported .glsl file, where nothing feeds the uniform block: every node with GLSL
   * runs in the shader, per-frame-only nodes use a stand-in from the GLSL backend or are baked from `controls` as literals.
   */
  standalone?: boolean
  /** The last value a per-frame node produced, for baking. */
  controls?: (nodeId: string, output: string) => FrameValue | undefined
}

export class FrontEnd {
  readonly program: Program = { nodes: {}, pixel: [], frame: [], uniforms: [], state: {}, resources: {}, output: null, issues: [], error: null, errorNode: null }
  /** Nodes on the current walk, for loop detection. */
  readonly visiting = new Set<string>()

  // per pass, by node id: what ./streams settled
  readonly resolved = new Map<string, ResolveResult>()
  readonly resolving = new Set<string>()
  // what ./placement decided
  readonly placement = new Map<string, Rate>()
  readonly changesPerPixel = new Set<string>()
  // what ./width inferred
  readonly widths = new Map<string, GlslType>()
  // what ./frame-plan, ./pixel-plan and ./uniforms recorded
  readonly steps = new Map<string, number>()
  readonly dims = new Map<string, Record<string, number>>()
  readonly emitted = new Set<string>()
  readonly perFrameSources = new Map<string, PixelSource>()
  /** Pixel state floats ./pixel-plan has handed out. */
  stateFloats = 0

  private readonly nodes: Map<string, StoredNode>
  private readonly incoming: Map<string, NodeGraph['edges'][number]>
  private readonly shapes = new Map<string, NodeShape>()
  private readonly valueSockets = new Map<string, Socket[]>()

  constructor(doc: NodeGraph, readonly options: CompileOptions) {
    this.nodes = new Map(doc.nodes.map((n) => [n.id, n]))
    this.incoming = edgesByInput(doc.edges)
  }

  get standalone() {
    return this.options.standalone === true
  }

  /** The node and the shape its values give it, settled once per node. */
  lookup(id: string): { node: StoredNode; shape: NodeShape } {
    const node = this.nodes.get(id)!
    let shape = this.shapes.get(id)
    if (!shape) {
      const kind = nodeItem(node.data.kind)
      if (!kind) throw new GraphError(`Unknown node type "${node.data.kind}"`, id)
      shape = kind.shape(node.data.values)
      this.shapes.set(id, shape)
    }
    return { node, shape }
  }

  /** The node's linkable number and vector inputs, filtered once per node. */
  valueInputs(id: string): Socket[] {
    let sockets = this.valueSockets.get(id)
    if (!sockets) {
      sockets = valueInputs(this.lookup(id).shape)
      this.valueSockets.set(id, sockets)
    }
    return sockets
  }

  /** Runs `body` with `id` on `path`; meeting `id` again inside it means the graph has a loop. */
  guard<T>(path: Set<string>, id: string, body: () => T): T {
    if (path.has(id)) throw new GraphError('The graph has a loop. Remove one of the links in the cycle.', id)
    path.add(id)
    const result = body()
    path.delete(id)
    return result
  }

  /** Where a socket's link comes from, when it has one and the source node exists. */
  linkSource(nodeId: string, socket: Socket): LinkSource | undefined {
    const edge = this.incoming.get(inputKey(nodeId, socket.name))
    return edge?.sourceHandle && this.nodes.has(edge.source) ? { id: edge.source, output: edge.sourceHandle } : undefined
  }

  /** Where a pixel consumer reads the node from, as ./placement decided; a node it never reached is a compiler bug. */
  placedAt(id: string): Rate {
    const placement = this.placement.get(id)
    if (!placement) throw new GraphError(`Node "${id}" was not placed`, id)
    return placement
  }

  /** Puts the node into the Program the first time a backend needs it. */
  record(id: string) {
    const { data } = this.lookup(id).node
    this.program.nodes[id] ??= { id, kind: data.kind, values: data.values, resolved: this.resolved.get(id)?.data ?? {}, width: this.widths.get(id) ?? null }
  }
}

/** Where a linked socket reads from: the source node and its output. */
export type LinkSource = { id: string; output: string }

export const isGenericSocket = (socket: Socket) => socket.linkable && socket.type.id === 'genType'

/** Slot name to type id, as the Program records a node's state. */
export function slotTypes(state: NonNullable<NodeShape['state']>): Record<string, string> {
  return Object.fromEntries(Object.entries(state).map(([name, type]) => [name, type.id]))
}

/** The value stored on the node for a socket, or its default; an invalid one is an error on the node. */
export function storedValue(nodeId: string, data: GraphNodeData, socket: Socket): unknown {
  const raw = data.values[socket.name] ?? socket.default
  if (!socket.type.check(raw)) throw new GraphError(`${socket.label || socket.name} is ${JSON.stringify(raw)}, not a valid ${socket.type.label}`, nodeId)
  return raw
}
