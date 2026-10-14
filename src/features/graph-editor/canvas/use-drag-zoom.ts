import { onBeforeUnmount, type Ref } from 'vue'
import type { VueFlowStore } from '@vue-flow/core'
import { zoomAround } from './use-wheel-zoom'

/** Blender's Ctrl+MMB: drag right or up to zoom in, around the point where the drag began. */
export function useDragZoom(flow: VueFlowStore, el: Ref<HTMLElement | undefined>) {
  let endDrag: (() => void) | null = null

  onBeforeUnmount(() => endDrag?.())

  return {
    onZoomDragStart(e: MouseEvent) {
      if (e.button !== 1 || !e.ctrlKey) return
      // Vue Flow pans on any middle press over a node, Ctrl or not
      e.preventDefault()
      e.stopPropagation()
      endDrag?.()
      const startZoom = flow.viewport.value.zoom
      const move = (at: MouseEvent) => zoomAround(flow, el.value!, e, startZoom * 2 ** ((at.clientX - e.clientX - (at.clientY - e.clientY)) / 200))
      const end = () => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', end)
        endDrag = null
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', end)
      endDrag = end
    },
  }
}
