import { onBeforeUnmount, onMounted, type Ref } from 'vue'

/** Calls `draw` once per animation frame while `target` is on screen and the tab is visible: an off-screen view or a hidden tab has nobody to draw for. */
export function useVisibleFrames(target: Ref<HTMLElement | undefined>, draw: () => void) {
  let raf = 0
  let visible = true
  let observer: IntersectionObserver | undefined

  const frame = () => {
    raf = requestAnimationFrame(frame)
    if (visible && !document.hidden) draw()
  }

  onMounted(() => {
    observer = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting))
    observer.observe(target.value!)
    raf = requestAnimationFrame(frame)
  })
  onBeforeUnmount(() => {
    cancelAnimationFrame(raf)
    observer?.disconnect()
  })
}
