import type { ColorRamp } from '@/lib/graph/nodes/color/color-ramp'
import { parseScenes, type Scene } from './scenes'
import { cloneJson } from '@/lib/util/json'

export interface NodeGraph {
  version: number
  nodes: StoredNode[]
  edges: StoredEdge[]
  /** Saved knob settings the Parameters panel can recall. */
  scenes?: Scene[]
}

/** Bumped whenever nodes or sockets change in a way older saved graphs cannot follow; `lib/documents` migrates old files */
export const GRAPH_VERSION = 4

export type SocketValue = number | number[] | string | boolean | ColorRamp

export interface GraphNodeData {
  kind: string
  /** Edited socket values by input name; sockets that were never edited use their default. */
  values: Record<string, SocketValue>
  /** Folded to its header in the editor. */
  collapsed?: boolean
  /** Shows only the sockets that hold a link. */
  hideUnused?: boolean
  /** Passes its first input that fits an output straight through, as if the node were not there. */
  muted?: boolean
  /** Shown in place of the node's title. */
  label?: string
}

export interface StoredNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: GraphNodeData
}

export interface StoredEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  style?: Record<string, string | number>
}

export const GRAPH_NODE_TYPE = 'shader'

export const newNodeData = (kind: string, values: GraphNodeData['values'] = {}): GraphNodeData => ({ kind, values })

/** A current-version graph, tidied: an input holds one link (the newest wins) and scenes are what parseScenes accepts. */
export function normalizeDoc(doc: NodeGraph): NodeGraph {
  return { version: GRAPH_VERSION, nodes: doc.nodes, edges: [...edgesByInput(doc.edges).values()], scenes: parseScenes(doc.scenes) }
}

/** The link into each input, keyed by `inputKey`; when an input has several, the last one wins. */
export function edgesByInput(edges: NodeGraph['edges']): Map<string, NodeGraph['edges'][number]> {
  return new Map(edges.map((e) => [inputKey(e.target, e.targetHandle), e]))
}

export const inputKey = (nodeId: string, handle: string | null | undefined) => `${nodeId}:${handle}`

interface NodeLike {
  id: string
  type?: string
  position: { x: number; y: number }
  data?: GraphNodeData
}

interface EdgeLike {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  style?: unknown
}

/**
 * The one shape and key order a graph is stored in. The editor's snapshot and a freshly parsed file both go through it,
 * so a file that was just opened serializes to the text it was compared against and does not count as edited.
 */
export function storedDoc(nodes: readonly NodeLike[], edges: readonly EdgeLike[], scenes: NodeGraph['scenes']): NodeGraph {
  return cloneJson({
    nodes: nodes.map((n) => ({ id: n.id, type: n.type ?? GRAPH_NODE_TYPE, position: { x: n.position.x, y: n.position.y }, data: n.data })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
      style: e.style,
    })),
    scenes: scenes ?? [],
    version: GRAPH_VERSION,
  }) as NodeGraph
}

export const canonical = (doc: NodeGraph) => storedDoc(doc.nodes, doc.edges, doc.scenes)

export function createDefaultGraph(): NodeGraph {
  const node = (id: string, kind: string, x: number, y: number, values: GraphNodeData['values'] = {}): StoredNode => ({
    id,
    type: GRAPH_NODE_TYPE,
    position: { x, y },
    data: { kind, values },
  })
  const edge = (source: string, sourceHandle: string, target: string, targetHandle: string, stroke: string): StoredEdge => ({
    id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`,
    source,
    sourceHandle,
    target,
    targetHandle,
    style: { stroke, strokeWidth: 2 },
  })
  const grey = '#a1a1a1'
  const yellow = '#c7c729'
  return {
    version: GRAPH_VERSION,
    nodes: [
      node('uv', 'uv', 0, 0),
      node('time', 'time', 0, 190),
      node('speed', 'math', 240, 170, { op: 'multiply', b: 0.2 }),
      node('offset', 'math', 500, 30, { op: 'add' }),
      node('rainbow', 'gradientPalette', 760, 40, { palette: 'rainbow' }),
      node('song', 'audioSource', 180, 370),
      node('bass', 'audio', 500, 300),
      node('lift', 'math', 760, 270, { op: 'add', b: 0.3 }),
      node('mix', 'math', 1020, 130, { op: 'multiply' }),
      node('out', 'output', 1280, 150),
    ],
    edges: [
      edge('time', 'time', 'speed', 'a', grey),
      edge('uv', 'x', 'offset', 'a', grey),
      edge('speed', 'result', 'offset', 'b', grey),
      edge('offset', 'result', 'rainbow', 'position', grey),
      edge('song', 'audio', 'bass', 'audio', '#e0853d'),
      edge('bass', 'kick', 'lift', 'a', grey),
      edge('rainbow', 'color', 'mix', 'a', yellow),
      edge('lift', 'result', 'mix', 'b', grey),
      edge('mix', 'result', 'out', 'color', yellow),
    ],
  }
}
