import { computed, nextTick, onBeforeUnmount, onMounted, reactive, watch } from 'vue'
import type { VueFlowStore } from '@vue-flow/core'
import { log } from '@/lib/app/logs'
import { graphImageDrop } from '@/lib/app/files/file-drop'
import type { GraphEditSession } from '@/lib/documents/sessions/graph-session'
import { GRAPH_FS, GRAPH_NODE_TYPE, findCompatibleSocket, newNodeData, findNodeItem, type GraphNodeData, type NodeItem } from '@/lib/graph'
import { filterFs, type MenuPreset } from '@/lib/shader/menu-fs'
import { newId } from '@/lib/util/ids'
import { connectLink, type PendingLink } from '@/features/graph-editor/canvas/use-link-drag'

/** Add-node menu: where it opened, the link dragged out of it, the node added (linked to that link); dropped image = Image Texture node */
export function useAddNode(flow: VueFlowStore, session: GraphEditSession, canvasRect: () => DOMRect | undefined) {
  const menu = reactive({ open: false, position: null as { x: number; y: number } | null, pending: null as PendingLink | null })

  // Link dragged into empty space offers only nodes it can attach to
  const menuFs = computed(() => {
    const pending = menu.pending
    if (!pending) return GRAPH_FS
    const need = pending.handleType === 'source' ? 'in' : 'out'
    return filterFs(GRAPH_FS, (item) => !!findCompatibleSocket(item.base, pending.type, need))
  })

  watch(
    () => menu.open,
    (open) => {
      if (!open) menu.pending = null
    },
  )

  /** At a screen point, or centered as a search palette w/o one */
  function openMenu(at: { x: number; y: number } | null, pending: PendingLink | null = null) {
    menu.pending = pending
    menu.position = at
    menu.open = true
  }

  function addNode(item: NodeItem, preset?: MenuPreset, screenPoint = menu.position) {
    const rect = canvasRect()
    const at = screenPoint ?? (rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 })
    const pending = menu.pending
    const position = flow.screenToFlowCoordinate(at)
    // Node feeding the dragged input goes left, so the link reads left to right
    if (pending?.handleType === 'target') position.x -= NODE_WIDTH
    const id = `${item.id}-${newId()}`
    flow.addNodes([{ id, type: GRAPH_NODE_TYPE, position, data: newNodeData(item.id, preset?.values as GraphNodeData['values']) }])
    log(`Added graph node: ${preset ? `${item.title} (${preset.title})` : item.title}`)

    const socket = pending && findCompatibleSocket(item.base, pending.type, pending.handleType === 'source' ? 'in' : 'out')
    if (pending && socket) {
      nextTick(() =>
        connectLink(
          flow,
          pending.handleType === 'source'
            ? { source: pending.nodeId, sourceHandle: pending.handleId, target: id, targetHandle: socket.name }
            : { source: id, sourceHandle: socket.name, target: pending.nodeId, targetHandle: pending.handleId },
        ),
      )
    }
    return id
  }

  /** Selected Image Texture node under the drop, its own undo step */
  function addImageTexture(imageId: string, title: string, at: { x: number; y: number }) {
    // Else a pending edit would undo together w/ the new node
    session.commitEdit()
    const rect = canvasRect()!
    const onCanvas = at.x >= rect.left && at.x <= rect.right && at.y >= rect.top && at.y <= rect.bottom
    const id = addNode(findNodeItem('imageTexture')!, { title, values: { filename: imageId } }, onCanvas ? at : null)
    nextTick(() => {
      flow.removeSelectedElements()
      const node = flow.findNode(id)
      if (node) flow.addSelectedNodes([node])
      session.recordNow()
    })
  }

  onMounted(() => (graphImageDrop.value = addImageTexture))
  onBeforeUnmount(() => {
    if (graphImageDrop.value === addImageTexture) graphImageDrop.value = null
  })

  return { menu, menuFs, openMenu, addNode }
}

/** About a node's width: offset from the point it's placed at */
export const NODE_WIDTH = 240
