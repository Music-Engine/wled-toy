import { inputSocket, outputSocket, storedShape } from '@/lib/graph/registry'
import { canCast } from '@/lib/graph/define/types'
import type { NodeShape } from '@/lib/graph/define/shape'
import { GRAPH_NODE_TYPE, type NodeGraph, type StoredNode } from './doc'

/**
 * What a hand-written graph gets wrong that the app would otherwise swallow: compiling only visits what reaches an
 * Output, and normalizeDoc keeps one edge per input. Run it on the graph as read, before normalizing.
 */
export function lintDoc(doc: NodeGraph): string[] {
  return [...lintNodes(doc), ...lintEdges(doc)]
}

function lintNodes(doc: NodeGraph): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const node of doc.nodes) {
    if (ids.has(node.id)) problems.push(`duplicate node id "${node.id}"`)
    ids.add(node.id)
    if (node.type !== GRAPH_NODE_TYPE) problems.push(`${node.id}: type must be "${GRAPH_NODE_TYPE}", not "${node.type}"`)
    if (!Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y)) problems.push(`${node.id}: position needs numeric x and y`)
    const shape = storedShape(node.data)
    if (!shape) {
      problems.push(`${node.id}: unknown node kind "${node.data?.kind}"`)
      continue
    }
    problems.push(...lintValues(node, shape))
  }
  return problems
}

function lintValues(node: StoredNode, shape: NodeShape): string[] {
  const problems: string[] = []
  for (const [name, value] of Object.entries(node.data.values ?? {})) {
    const socket = shape.inputs.find((s) => s.name === name)
    if (!socket) problems.push(`${node.id}: "${name}" is not an input of ${node.data.kind} with these values (inputs: ${shape.inputs.map((s) => s.name).join(', ')})`)
    else if (!socket.type.check(value)) problems.push(`${node.id}.${name}: ${JSON.stringify(value)} is not a valid ${socket.type.label}`)
  }
  return problems
}

function lintEdges(doc: NodeGraph): string[] {
  const problems: string[] = []
  const byId = new Map(doc.nodes.map((n) => [n.id, n]))
  const edgeIds = new Set<string>()
  const targets = new Set<string>()
  for (const edge of doc.edges) {
    if (edgeIds.has(edge.id)) problems.push(`duplicate edge id "${edge.id}"`)
    edgeIds.add(edge.id)
    const input = `${edge.target}.${edge.targetHandle}`
    if (targets.has(input)) problems.push(`edge ${edge.id}: "${input}" already has a link; only the last one is kept`)
    targets.add(input)
    const from = outputSocket(byId.get(edge.source)?.data, edge.sourceHandle)
    const to = inputSocket(byId.get(edge.target)?.data, edge.targetHandle)
    if (!from) problems.push(`edge ${edge.id}: "${edge.source}" has no output "${edge.sourceHandle}"`)
    if (!to) problems.push(`edge ${edge.id}: "${edge.target}" has no linkable input "${edge.targetHandle}"`)
    if (from && to && !canCast(from.type, to.type)) problems.push(`edge ${edge.id}: ${from.type.label} cannot link to ${to.type.label}`)
  }
  return problems
}
