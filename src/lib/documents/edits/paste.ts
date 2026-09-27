import type { GraphNodeData, StoredEdge } from '@/lib/graph'
import { newId } from '@/lib/util/ids'
import { cloneJson } from '@/lib/util/json'

export interface ClipNode {
  id: string
  position: { x: number; y: number }
  data: GraphNodeData
}

/**
 * Copies of copied nodes and the links between them under fresh ids, so a paste never collides with the originals or
 * with an earlier paste. Links with an end outside the copied nodes are dropped. Positions are unchanged; placing the
 * copies is the editor's job.
 */
export function remapPasted(nodes: readonly ClipNode[], edges: readonly StoredEdge[]): { nodes: ClipNode[]; edges: StoredEdge[] } {
  const stamp = newId()
  const ids = new Map(nodes.map((n, i) => [n.id, `${n.data.kind}-${stamp}-${i}`]))
  return {
    nodes: nodes.map((n) => ({ id: ids.get(n.id)!, position: { ...n.position }, data: cloneJson(n.data) })),
    edges: edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e, i) => ({ ...e, id: `e-${stamp}-${i}`, source: ids.get(e.source)!, target: ids.get(e.target)! })),
  }
}
