import { nextTick, onActivated, onBeforeUnmount, onDeactivated } from 'vue'
import type { GraphNode, VueFlowStore } from '@vue-flow/core'
import { inEditableTarget } from '@/lib/app/commands'
import { log } from '@/lib/app/logs'
import type { GraphEditSession } from '@/lib/documents/sessions/graph-session'
import { remapPasted, type ClipNode } from '@/lib/documents/edits/paste'
import { GRAPH_NODE_TYPE, type GraphNodeData, type StoredEdge } from '@/lib/graph'
import { cloneJson } from '@/lib/util/json'
import { selectNodes } from '@/features/graph-editor/canvas/use-box-select'
import { NODE_WIDTH } from '@/features/graph-editor/node-menu/use-add-node'

type ClipboardAction = 'copy' | 'cut' | 'paste' | 'dissolve'

/**
 * Copy, cut and paste of nodes through an in-memory clipboard, and dissolve, from the registered commands and from the
 * window's clipboard events while the editor is shown.
 */
export function useNodeClipboard(
  flow: VueFlowStore,
  session: GraphEditSession,
  pointerAt: () => { x: number; y: number } | null,
  menuOpen: () => boolean,
  dissolve: () => void,
) {
  let clipboard: { nodes: ClipNode[]; edges: StoredEdge[] } | null = null
  let commandAt = -Infinity

  function copySelection(): boolean {
    const selected = flow.getSelectedNodes.value
    if (!selected.length) return false
    clipboard = { nodes: selected.map(clipNode), edges: session.snapshot().edges }
    log(`Copied ${selected.length} node${selected.length > 1 ? 's' : ''}`)
    return true
  }

  function pasteClipboard(): boolean {
    if (!clipboard) return false
    const pasted = remapPasted(clipboard.nodes, clipboard.edges)
    const xs = clipboard.nodes.map((n) => n.position.x)
    const ys = clipboard.nodes.map((n) => n.position.y)
    // under the pointer when it is over the canvas, otherwise next to the originals
    const pointer = pointerAt()
    const target = pointer ? flow.screenToFlowCoordinate(pointer) : null
    const shift = target
      ? { x: target.x - NODE_WIDTH / 2 - (Math.min(...xs) + Math.max(...xs)) / 2, y: target.y - (Math.min(...ys) + Math.max(...ys)) / 2 }
      : { x: 40, y: 40 }
    flow.addNodes(pasted.nodes.map((n) => ({ ...n, type: GRAPH_NODE_TYPE, position: { x: n.position.x + shift.x, y: n.position.y + shift.y } })))
    nextTick(() => {
      flow.addEdges(pasted.edges)
      flow.addSelectedNodes(pasted.nodes.map((n) => flow.findNode(n.id)!).filter(Boolean))
    })
    log(`Pasted ${clipboard.nodes.length} node${clipboard.nodes.length > 1 ? 's' : ''}`)
    return true
  }

  function run(action: ClipboardAction): boolean {
    if (action === 'paste') return pasteClipboard()
    if (action === 'dissolve') {
      if (!flow.getSelectedNodes.value.length) return false
      dissolve()
      return true
    }
    if (!copySelection()) return false
    if (action === 'cut') deleteSelection(flow)
    return true
  }

  // Under a native Edit menu Cmd+C, Cmd+X and Cmd+V never arrive as keys: the menu item takes them and the page gets the
  // clipboard event. The Cut item owns Cmd+X so text fields can cut, and on the canvas its event means what Cmd+X means
  // there: dissolve. Text the user selected elsewhere on the page keeps the browser's own copy.
  function onClipboardEvent(e: ClipboardEvent) {
    if (menuOpen() || performance.now() - commandAt < 100 || inEditableTarget(e) || !!window.getSelection()?.toString()) return
    if (run(e.type === 'cut' ? 'dissolve' : (e.type as ClipboardAction))) e.preventDefault()
  }

  const listen = () => {
    for (const type of ['copy', 'cut', 'paste'] as const) window.addEventListener(type, onClipboardEvent)
  }
  const unlisten = () => {
    for (const type of ['copy', 'cut', 'paste'] as const) window.removeEventListener(type, onClipboardEvent)
  }
  onActivated(listen)
  onDeactivated(unlisten)
  onBeforeUnmount(unlisten)

  return {
    /** A key the dispatcher handled cancels its clipboard event; should one arrive all the same, it must not run the action a second time. */
    command(action: ClipboardAction) {
      commandAt = performance.now()
      return run(action)
    },
  }
}

export function deleteSelection(flow: VueFlowStore) {
  flow.removeEdges(flow.getSelectedEdges.value)
  flow.removeNodes(flow.getSelectedNodes.value)
}

const clipNode = (n: GraphNode): ClipNode => ({ id: n.id, position: { ...n.position }, data: cloneJson(n.data) as GraphNodeData })

/**
 * Shift+D: copies of the selection and the links among them, on top of the originals and selected in their place,
 * leaving the node clipboard alone. False when nothing is selected.
 */
export async function duplicateSelection(flow: VueFlowStore, session: GraphEditSession): Promise<boolean> {
  const selected = flow.getSelectedNodes.value
  if (!selected.length) return false
  const copies = remapPasted(selected.map(clipNode), session.snapshot().edges)
  flow.addNodes(copies.nodes.map((n) => ({ ...n, type: GRAPH_NODE_TYPE })))
  await nextTick()
  flow.addEdges(copies.edges)
  // Shift is still down, and Vue Flow adds to the selection while it is
  flow.removeSelectedElements()
  selectNodes(flow, new Set(copies.nodes.map((n) => n.id)))
  return true
}
