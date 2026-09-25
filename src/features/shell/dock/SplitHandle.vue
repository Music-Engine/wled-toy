<script setup lang="ts">
import { clamp } from '@/lib/util/math'

const props = defineProps<{ orientation: 'vertical' | 'horizontal'; min: number; max: number; initial: number; label: string }>()
const size = defineModel<number>({ required: true })
const emit = defineEmits<{ collapse: [] }>()

let drag: { pointer: number; size: number } | null = null

const along = (e: PointerEvent) => (props.orientation === 'vertical' ? e.clientX : e.clientY)

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  drag = { pointer: along(e), size: size.value }
}

function onPointerMove(e: PointerEvent) {
  if (!drag) return
  // the handle sits before the panel it sizes, so moving toward the start edge grows the panel
  const wanted = drag.size + drag.pointer - along(e)
  if (wanted < props.min / 2) {
    size.value = drag.size
    drag = null
    emit('collapse')
    return
  }
  size.value = Math.round(clamp(wanted, props.min, props.max))
}

function onKeydown(e: KeyboardEvent) {
  const [grow, shrink] = props.orientation === 'vertical' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
  if (e.key !== grow && e.key !== shrink) return
  e.preventDefault()
  size.value = Math.round(clamp(size.value + (e.key === grow ? 16 : -16), props.min, props.max))
}
</script>

<template>
  <div
    class="split-handle relative z-10 shrink-0 touch-none bg-(--app-hairline) outline-none after:absolute hover:bg-primary focus-visible:bg-primary active:bg-primary"
    :class="orientation === 'vertical' ? 'w-px cursor-col-resize after:inset-y-0 after:-inset-x-[3px]' : 'h-px cursor-row-resize after:inset-x-0 after:-inset-y-[3px]'"
    role="separator"
    tabindex="0"
    :aria-label="label"
    :aria-orientation="orientation"
    :aria-valuenow="size"
    :aria-valuemin="min"
    :aria-valuemax="max"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="drag = null"
    @pointercancel="drag = null"
    @dblclick="size = Math.round(clamp(initial, min, max))"
    @keydown="onKeydown"
  />
</template>
