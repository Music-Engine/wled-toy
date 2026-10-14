import type { Ref } from 'vue'
import type { VueFlowStore } from '@vue-flow/core'
import { useBoxSelect } from './use-box-select'
import { useDragZoom } from './use-drag-zoom'
import { useLinkDrag, type PendingLink } from './use-link-drag'
import { useWheelZoom } from './use-wheel-zoom'

/** Everything the pointer does on the canvas beyond Vue Flow's own handling, and where it last was. */
export function useCanvasPointer(
  flow: VueFlowStore,
  el: Ref<HTMLElement | undefined>,
  offerNodes: (at: { x: number; y: number }, pending: PendingLink) => void,
) {
  const pointer = { x: 0, y: 0, inside: false }
  const links = useLinkDrag(flow, offerNodes)
  const box = useBoxSelect(flow)
  const dragZoom = useDragZoom(flow, el)
  useWheelZoom(flow, el)

  return {
    isValidConnection: links.isValidConnection,
    noteSelection: box.noteSelection,
    onZoomDragStart: dragZoom.onZoomDragStart,
    /** The last pointer position over the canvas, or null once it left. */
    pointerAt: () => (pointer.inside ? { x: pointer.x, y: pointer.y } : null),
    track(e: PointerEvent) {
      pointer.x = e.clientX
      pointer.y = e.clientY
      pointer.inside = true
    },
    leave() {
      pointer.inside = false
    },
  }
}
