import { listItems, GRAPH_NODE_TYPE, newNodeData, type EnumOption, type GraphNodeData, type NodeItem, type StoredNode } from '@/lib/graph'

/** Every registered kind in every socket arrangement it has, each expanded and collapsed. Positions are left to the gallery. */
export const galleryNodes = (): StoredNode[] => listItems().flatMap((item) => galleryVariants(item).flatMap(({ label, values }) => {
  const id = label ? `${item.id}:${label}` : item.id
  return [
    { id, type: GRAPH_NODE_TYPE, position: { x: 0, y: 0 }, data: newNodeData(item.id, values) },
    { id: `${id}~collapsed`, type: GRAPH_NODE_TYPE, position: { x: 0, y: 0 }, data: { ...newNodeData(item.id, values), collapsed: true } },
  ]
}))

/** The default values, then one set per enum option that gives the node sockets no earlier set gave it. */
export function galleryVariants(item: NodeItem): { label: string; values: GraphNodeData['values'] }[] {
  const variants = [{ label: '', values: {} as GraphNodeData['values'] }]
  const seen = new Set([socketsOf(item, {})])
  for (const socket of item.base.inputs) {
    if (socket.type.id !== 'enum') continue
    for (const option of socket.type.props!.options as readonly EnumOption[]) {
      const values = { [socket.name]: option.value }
      const sockets = socketsOf(item, values)
      if (seen.has(sockets)) continue
      seen.add(sockets)
      variants.push({ label: option.value, values })
    }
  }
  return variants
}

const socketsOf = (item: NodeItem, values: GraphNodeData['values']) => {
  const shape = item.shape(values)
  return JSON.stringify([shape.inputs.map((s) => [s.name, s.label, s.type.id, s.linkable]), shape.outputs.map((s) => [s.name, s.label, s.type.id])])
}
