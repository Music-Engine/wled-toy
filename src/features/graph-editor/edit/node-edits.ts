import type { VueFlowStore } from '@vue-flow/core'
import { selectNodes } from '@/features/graph-editor/canvas/use-box-select'
import { connectLink } from '@/features/graph-editor/canvas/use-link-drag'
import { deleteSelection } from '@/features/graph-editor/clipboard/use-node-clipboard'
import { canConnect, dissolveLinks } from '@/lib/documents/links'
import { storedShape, type GraphNodeData } from '@/lib/graph'

// Blender's node editor commands on the selection. A flag switched off is written as undefined, which the saved graph leaves out.

const dataOf = (flow: VueFlowStore, id: string) => flow.findNode(id)?.data as GraphNodeData | undefined
const selectedIds = (flow: VueFlowStore) => new Set(flow.getSelectedNodes.value.map((n) => n.id))

/** H and Ctrl+H: sets the flag on every selected node, or clears it when all of them have it. */
export function toggleShared(flow: VueFlowStore, flag: 'collapsed' | 'hideUnused') {
  const nodes = flow.getSelectedNodes.value
  const on = !nodes.every((n) => (n.data as GraphNodeData)[flag])
  for (const n of nodes) flow.updateNodeData<GraphNodeData>(n.id, { [flag]: on || undefined })
}

/** M: each selected node flips on its own. */
export function toggleMute(flow: VueFlowStore) {
  for (const n of flow.getSelectedNodes.value) flow.updateNodeData<GraphNodeData>(n.id, { muted: !(n.data as GraphNodeData).muted || undefined })
}

/** F: each selected node, left to right, feeds the next through the first free input one of its outputs can link to. */
export function linkSelected(flow: VueFlowStore) {
  const nodes = [...flow.getSelectedNodes.value].sort((a, b) => a.position.x - b.position.x)
  for (let i = 1; i < nodes.length; i++) {
    const [from, to] = [nodes[i - 1].id, nodes[i].id]
    const free = (storedShape(dataOf(flow, to))?.inputs ?? [])
      .filter((s) => s.linkable && !flow.edges.value.some((e) => e.target === to && e.targetHandle === s.name))
    const link = (storedShape(dataOf(flow, from))?.outputs ?? [])
      .flatMap((out) => free.map((input) => ({ source: from, sourceHandle: out.name, target: to, targetHandle: input.name })))
      .find((c) => canConnect(c, (id) => dataOf(flow, id)))
    if (link) connectLink(flow, link)
  }
}

/** Ctrl+X: removes the selection and joins what fed it to what it fed, where the sockets allow. */
export function dissolveSelection(flow: VueFlowStore) {
  const links = dissolveLinks(flow.edges.value, selectedIds(flow), (id) => dataOf(flow, id))
  for (const link of links) connectLink(flow, { ...link, sourceHandle: link.sourceHandle ?? null, targetHandle: link.targetHandle ?? null })
  deleteSelection(flow)
}

export function invertSelection(flow: VueFlowStore) {
  const selected = selectedIds(flow)
  selectNodes(flow, new Set(flow.getNodes.value.filter((n) => !selected.has(n.id)).map((n) => n.id)))
}

/** L and Shift+L: adds the nodes one link upstream (`from`) or downstream (`to`) of the selection. */
export function selectLinked(flow: VueFlowStore, direction: 'from' | 'to') {
  const selected = flow.getSelectedNodes.value
  const linked = selected.flatMap((n) => (direction === 'from' ? flow.getIncomers(n.id) : flow.getOutgoers(n.id)))
  selectNodes(flow, new Set([...selected, ...linked].map((n) => n.id)))
}
