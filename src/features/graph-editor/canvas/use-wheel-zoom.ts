import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import type { VueFlowStore } from '@vue-flow/core'

/**
 * A mouse wheel zooms around the pointer and a trackpad pans, pinching zooms. Vue Flow either zooms or pans on every
 * wheel event, so its own scroll handling is off and the canvas element takes the wheel instead.
 */
export function useWheelZoom(flow: VueFlowStore, el: Ref<HTMLElement | undefined>) {
  let gesture: WheelGesture | null = null

  function onWheel(e: WheelEvent) {
    const target = e.target as Element
    // nowheel marks content that scrolls itself inside the viewport
    if (!target.closest('.vue-flow__viewport') || target.closest('.nowheel')) return
    e.preventDefault()
    gesture = classifyWheel(e as WheelEvent & { wheelDeltaY?: number }, gesture)
    if (gesture.source === 'wheel') zoomAround(flow, el.value!, e, flow.viewport.value.zoom * 1.2 ** -Math.sign(e.deltaY))
    // a pinch arrives as a wheel event with ctrlKey set
    else if (e.ctrlKey || e.metaKey) zoomAround(flow, el.value!, e, flow.viewport.value.zoom * 2 ** (-Math.max(-25, Math.min(25, e.deltaY)) * 0.02))
    else flow.panBy({ x: -e.deltaX, y: -e.deltaY })
  }

  // passive: false so the canvas can take the scroll; events it does not handle are left alone
  onMounted(() => el.value!.addEventListener('wheel', onWheel, { passive: false }))
  onBeforeUnmount(() => el.value?.removeEventListener('wheel', onWheel))
}

/** Zooms so the flow point under `point` stays under it. */
export function zoomAround(flow: VueFlowStore, el: HTMLElement, point: { clientX: number; clientY: number }, zoom: number) {
  const rect = el.getBoundingClientRect()
  const from = flow.viewport.value
  const next = Math.min(flow.maxZoom.value, Math.max(flow.minZoom.value, zoom))
  const x = point.clientX - rect.left
  const y = point.clientY - rect.top
  flow.setViewport({ x: x - ((x - from.x) * next) / from.zoom, y: y - ((y - from.y) * next) / from.zoom, zoom: next })
}

export type WheelSource = 'wheel' | 'trackpad'

export interface WheelSample {
  deltaX: number
  deltaY: number
  deltaMode: number
  timeStamp: number
  wheelDeltaY?: number
}

export interface WheelGesture {
  source: WheelSource
  timeStamp: number
}

/**
 * Tells a mouse wheel from two-finger trackpad scrolling, which reach the page as the same event.
 * The first event after a pause decides and the rest of the gesture keeps that answer, because the tail of a trackpad
 * scroll can look like a wheel step (one axis, a large round delta) and would otherwise zoom in the middle of a pan.
 */
export function classifyWheel(e: WheelSample, previous: WheelGesture | null): WheelGesture {
  if (previous && e.timeStamp - previous.timeStamp < 200) return { source: previous.source, timeStamp: e.timeStamp }
  return { source: isWheelStep(e) ? 'wheel' : 'trackpad', timeStamp: e.timeStamp }
}

function isWheelStep({ deltaX, deltaY, deltaMode, wheelDeltaY }: WheelSample) {
  // only a wheel scrolls by lines or pages (Firefox); a wheel has one axis, and Shift+wheel, which the OS turns sideways, should pan
  if (deltaMode !== 0) return true
  if (deltaX !== 0 || deltaY === 0) return false
  // Chrome on Windows and Linux reports 120 per notch whatever the pixel delta is; a trackpad's first delta is a few pixels
  if (wheelDeltaY && wheelDeltaY % 120 === 0) return true
  // macOS gives a wheel a 16.16 fixed-point line count (0.1 for a slow notch) and Chrome and WebKit multiply it by 40 px,
  // hence deltaY 4.000244140625; trackpad deltas are whole points or binary fractions of one on a scaled display
  const lineUnits = (deltaY * 65536) / 40
  return !Number.isInteger(deltaY * 8) && Math.abs(lineUnits - Math.round(lineUnits)) < 1e-6
}
