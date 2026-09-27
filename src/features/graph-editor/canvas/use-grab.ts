import { onBeforeUnmount, onDeactivated, ref } from 'vue'
import type { VueFlowStore } from '@vue-flow/core'
import type { GraphEditSession } from '@/lib/documents/sessions/graph-session'

type Point = { x: number; y: number }

/**
 * Blender's G: the selected nodes follow the pointer until a click drops them or Escape puts them back, and the move is
 * one undo step. While it runs the window's pointer presses and Escape belong to it: they are taken in the capture
 * phase, before the canvas selects or pans and before the key dispatcher deselects.
 */
export function useGrab(flow: VueFlowStore, session: GraphEditSession, pointerAt: () => Point | null) {
  const active = ref(false)
  let end: ((commit: boolean) => void) | null = null

  function start() {
    const nodes = flow.getSelectedNodes.value
    if (!nodes.length || end) return
    const origins = new Map(nodes.map((n) => [n.id, { ...n.position }]))
    const release = session.holdHistory()
    const at = pointerAt()
    // outside the canvas the move starts from wherever the pointer next shows up
    let from = at && flow.screenToFlowCoordinate(at)
    const place = (dx: number, dy: number) => {
      for (const [id, origin] of origins) flow.updateNode(id, { position: { x: origin.x + dx, y: origin.y + dy } })
    }
    const move = (e: Event) => {
      const { clientX, clientY } = e as PointerEvent
      const to = flow.screenToFlowCoordinate({ x: clientX, y: clientY })
      from ??= to
      place(to.x - from.x, to.y - from.y)
    }
    const swallow = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }
    const drop = (e: Event) => {
      swallow(e)
      finish(true)
    }
    const cancel = (e: Event) => {
      if ((e as KeyboardEvent).key !== 'Escape') return
      swallow(e)
      finish(false)
    }
    const listeners = { pointermove: move, pointerdown: swallow, mousedown: swallow, click: drop, keydown: cancel }

    function finish(commit: boolean) {
      for (const [type, listener] of Object.entries(listeners)) window.removeEventListener(type, listener, true)
      if (!commit) place(0, 0)
      void release(commit)
      end = null
      active.value = false
    }

    for (const [type, listener] of Object.entries(listeners)) window.addEventListener(type, listener, true)
    end = finish
    active.value = true
  }

  const abandon = () => end?.(false)
  onDeactivated(abandon)
  onBeforeUnmount(abandon)

  return { active, start }
}
