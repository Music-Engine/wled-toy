import { canCast, inputSocket, outputSocket, placement, storedShape, type DataType, type GraphNodeData, type NodeGraph, type StoredEdge } from '@/lib/graph'

export interface LinkEnds {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

/** How the editor colors a link carrying `type`. */
export type SocketColor = (type: DataType<any>) => string

/** Whether a link from `c.source` may feed `c.target`; `dataOf` looks a node up by id. */
export function canConnect(c: LinkEnds, dataOf: (id: string) => GraphNodeData | undefined): boolean {
  if (c.source === c.target) return false
  const from = outputSocket(dataOf(c.source), c.sourceHandle)
  const to = inputSocket(dataOf(c.target), c.targetHandle)
  // a per-frame node computes once per frame, so nothing that exists only per pixel can feed it
  const perPixelIntoControl = placement(storedShape(dataOf(c.source))!) === 'pixel' && placement(storedShape(dataOf(c.target))!) === 'frame'
  return !!from && !!to && canCast(from.type, to.type) && !perPixelIntoControl
}

/** A hand-written file has no edge styles; the editor colors a link by its source socket when it is drawn. */
export function styledEdges(doc: NodeGraph, colorOf: SocketColor): StoredEdge[] {
  const byId = new Map(doc.nodes.map((n) => [n.id, n.data]))
  return doc.edges.map((e) => {
    const from = e.style?.stroke ? undefined : outputSocket(byId.get(e.source), e.sourceHandle)
    return from ? { ...e, style: { stroke: colorOf(from.type), strokeWidth: 2 } } : e
  })
}
