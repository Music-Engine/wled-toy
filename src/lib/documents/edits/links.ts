import { canCast, findInputSocket, findOutputSocket, readStoredShape, type DataType, type GraphNodeData, type NodeGraph, type StoredEdge } from '@/lib/graph'

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
  const from = findOutputSocket(dataOf(c.source), c.sourceHandle)
  const to = findInputSocket(dataOf(c.target), c.targetHandle)
  return !!from && !!to && canCast(from.type, to.type)
}

/**
 * Blender's dissolve: what feeds the nodes that stay once `dissolved` are removed. Each link out of a dissolved node
 * into a node that stays is fed instead by the first link into the dissolved node, in input order and followed through
 * other dissolved nodes, whose source `canConnect` to that input; with none, the input is left unlinked.
 */
export function dissolveLinks(edges: readonly LinkEnds[], dissolved: ReadonlySet<string>, dataOf: (id: string) => GraphNodeData | undefined): LinkEnds[] {
  const feed = (id: string, into: LinkEnds, seen: Set<string>): LinkEnds | undefined => {
    if (seen.has(id)) return undefined
    seen.add(id)
    const order = readStoredShape(dataOf(id))?.inputs.map((s) => s.name) ?? []
    const incoming = edges.filter((e) => e.target === id).sort((a, b) => order.indexOf(a.targetHandle!) - order.indexOf(b.targetHandle!))
    for (const e of incoming) {
      const link = dissolved.has(e.source)
        ? feed(e.source, into, seen)
        : { source: e.source, sourceHandle: e.sourceHandle, target: into.target, targetHandle: into.targetHandle }
      if (link && canConnect(link, dataOf)) return link
    }
    return undefined
  }
  return edges.filter((e) => dissolved.has(e.source) && !dissolved.has(e.target)).flatMap((e) => feed(e.source, e, new Set()) ?? [])
}

/** A hand-written file has no edge styles; the editor colors a link by its source socket when it is drawn. */
export function styleEdges(doc: NodeGraph, colorOf: SocketColor): StoredEdge[] {
  const byId = new Map(doc.nodes.map((n) => [n.id, n.data]))
  return doc.edges.map((e) => {
    const from = e.style?.stroke ? undefined : findOutputSocket(byId.get(e.source), e.sourceHandle)
    return from ? { ...e, style: { stroke: colorOf(from.type), strokeWidth: 2 } } : e
  })
}
