import { nextTick, onActivated, onBeforeUnmount, onDeactivated } from 'vue'
import type { VueFlowStore } from '@vue-flow/core'
import { inEditableTarget } from '@/lib/app/commands'
import { log } from '@/lib/app/logs'
import type { GraphEditSession } from '@/lib/documents/graph-session'
import { remapPasted, type ClipNode } from '@/lib/documents/paste'
import { GRAPH_NODE_TYPE, type GraphNodeData, type StoredEdge } from '@/lib/graph'
import { cloneJson } from '@/lib/util/json'
import { NODE_WIDTH } from '@/features/graph-editor/node-menu/use-add-node'

type ClipboardAction = 'copy' | 'cut' | 'paste'

/**
 * Copy, cut and paste of nodes through an in-memory clipboard, from the registered commands and from the window's
 * clipboard events while the editor is shown.
 */
export function useNodeClipboard(flow: VueFlowStore, session: GraphEditSession, pointerAt: () => { x: number; y: number } | null, menuOpen: () => boolean) {
  let clipboard: { nodes: ClipNode[]; edges: StoredEdge[] } | null = null
  let commandAt = -Infinity

  function copySelection(): boolean {
    const selected = flow.getSelectedNodes.value
    if (!selected.length) return false
    const ids = new Set(selected.map((n) => n.id))
    clipboard = {
      nodes: selected.map((n) => ({ id: n.id, position: { ...n.position }, data: cloneJson(n.data) as GraphNodeData })),
      // only links inside the selection travel with it, like in Blender
      edges: session.snapshot().edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    }
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
    if (!copySelection()) return false
    if (action === 'cut') deleteSelection(flow)
    return true
  }

  // Under a native Edit menu Cmd+C, Cmd+X and Cmd+V never arrive as keys: the menu item takes them and the page gets the
  // clipboard event. Text the user selected elsewhere on the page keeps the browser's own copy.
  function onClipboardEvent(e: ClipboardEvent) {
    if (menuOpen() || performance.now() - commandAt < 100 || inEditableTarget(e) || !!window.getSelection()?.toString()) return
    if (run(e.type as ClipboardAction)) e.preventDefault()
  }

  const listen = () => { for (const type of ['copy', 'cut', 'paste'] as const) window.addEventListener(type, onClipboardEvent) }
  const unlisten = () => { for (const type of ['copy', 'cut', 'paste'] as const) window.removeEventListener(type, onClipboardEvent) }
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
