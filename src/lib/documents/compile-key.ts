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
 * Everything generateGlsl reads from a graph, so equal keys compile to the same output. Positions, selection, sizes,
 * folding and link styles are left out. Document order stays: the compiler walks sinks in it, and the last link into
 * an input wins.
 */
export const compileKey = (nodes: readonly KeyedNode[], edges: readonly KeyedEdge[]): string => JSON.stringify([
  nodes.map((n) => [n.id, n.data?.kind, n.data?.values]),
  edges.map((e) => [e.source, e.sourceHandle ?? null, e.target, e.targetHandle ?? null]),
])
