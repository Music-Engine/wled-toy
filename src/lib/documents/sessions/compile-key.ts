import type { GraphNodeData } from '@/lib/graph'

interface KeyedNode {
  id: string
  data?: GraphNodeData
}

interface KeyedEdge {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

/**
 * What the compiler reads, so equal keys compile the same: no positions, selection, sizes, folding, hidden sockets,
 * labels, link styles or Knob value (a uniform). Document order stays: sinks walk in it, last link into an input wins
 */
export const compileKey = (nodes: readonly KeyedNode[], edges: readonly KeyedEdge[]): string =>
  JSON.stringify([
    nodes.map((n) => [n.id, n.data?.kind, n.data?.kind === 'knob' ? { ...n.data.values, value: undefined } : n.data?.values, n.data?.muted ?? false]),
    edges.map((e) => [e.source, e.sourceHandle ?? null, e.target, e.targetHandle ?? null]),
  ])
