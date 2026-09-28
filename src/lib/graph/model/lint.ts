import { findInputSocket, findOutputSocket, readStoredShape } from '@/lib/graph/registry'
import { canCast } from '@/lib/graph/define/types'
import type { NodeShape } from '@/lib/graph/define/shape'
import { GRAPH_NODE_TYPE, type NodeGraph, type StoredNode } from './doc'

/** What the app would otherwise swallow: compile visits only what reaches an Output, normalizeDoc keeps one edge per input */
export function lintDoc(doc: NodeGraph): string[] {
  return [...lintNodes(doc), ...lintEdges(doc).map((problem) => problem.message)]
}

function lintNodes(doc: NodeGraph): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const node of doc.nodes) {
    if (ids.has(node.id)) problems.push(`duplicate node id "${node.id}"`)
    ids.add(node.id)
    if (node.type !== GRAPH_NODE_TYPE) problems.push(`${node.id}: type must be "${GRAPH_NODE_TYPE}", not "${node.type}"`)
    if (!Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y)) problems.push(`${node.id}: position needs numeric x and y`)
    const shape = readStoredShape(node.data)
    if (!shape) {
      problems.push(`${node.id}: unknown node kind "${node.data?.kind}"`)
      continue
    }
    problems.push(...lintValues(node, shape), ...lintFlags(node))
  }
  return problems
}

function lintFlags(node: StoredNode): string[] {
  const problems: string[] = []
  for (const name of ['hideUnused', 'muted'] as const) {
    const value = node.data[name]
    if (value !== undefined && typeof value !== 'boolean') problems.push(`${node.id}.${name}: ${JSON.stringify(value)} is not true or false`)
  }
  const { label } = node.data
  if (label !== undefined && typeof label !== 'string') problems.push(`${node.id}.label: ${JSON.stringify(label)} is not text`)
  return problems
}

function lintValues(node: StoredNode, shape: NodeShape): string[] {
  const problems: string[] = []
  for (const [name, value] of Object.entries(node.data.values ?? {})) {
    const socket = shape.inputs.find((input) => input.name === name)
    if (!socket) problems.push(`${node.id}: "${name}" is not an input of ${node.data.kind} with these values (inputs: ${shape.inputs.map((socket) => socket.name).join(', ')})`)
    else if (!socket.type.check(value)) problems.push(`${node.id}.${name}: ${JSON.stringify(value)} is not a valid ${socket.type.label}`)
  }
  return problems
}

/** Edges alone: stored values of sockets an op hides are kept on purpose, so the compiler lints only these */
export function lintEdges(doc: NodeGraph): { nodeId: string | null; message: string }[] {
  const problems: { nodeId: string | null; message: string }[] = []
  const byId = new Map(doc.nodes.map((node) => [node.id, node]))
  // On the target node, so Problems can jump to it
  const report = (edge: NodeGraph['edges'][number], message: string) => problems.push({ nodeId: byId.has(edge.target) ? edge.target : null, message })
  const edgeIds = new Set<string>()
  const targets = new Set<string>()
  for (const edge of doc.edges) {
    if (edgeIds.has(edge.id)) report(edge, `duplicate edge id "${edge.id}"`)
    edgeIds.add(edge.id)
    const input = `${edge.target}.${edge.targetHandle}`
    if (targets.has(input)) report(edge, `edge ${edge.id}: "${input}" already has a link; only the last one is kept`)
    targets.add(input)
    const from = findOutputSocket(byId.get(edge.source)?.data, edge.sourceHandle)
    const to = findInputSocket(byId.get(edge.target)?.data, edge.targetHandle)
    if (!from) report(edge, `edge ${edge.id}: "${edge.source}" has no output "${edge.sourceHandle}"`)
    if (!to) report(edge, `edge ${edge.id}: "${edge.target}" has no linkable input "${edge.targetHandle}"`)
    if (from && to && !canCast(from.type, to.type)) report(edge, `edge ${edge.id}: ${from.type.label} cannot link to ${to.type.label}`)
  }
  return problems
}
