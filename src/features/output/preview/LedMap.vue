<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { useEngine } from '@/lib/engine/engine'
import { layoutPositions, type Layout, type Segment } from '@/lib/engine/output/layout'
import { SEEN } from './led-colors'
import { useVisibleFrames } from './use-visible-frames'

const props = defineProps<{ layout: Layout }>()
const engine = useEngine()
const root = ref<HTMLElement>()
const lights = ref<HTMLCanvasElement>()
const glow = ref<HTMLCanvasElement>()
const blur = ref(0)
let [w, h, dpr] = [0, 0, 1]
let cssBox = { width: 0, height: 0 }
const box = { left: 0, top: 0, width: 0, height: 0, radius: 0 }
let drawnRevision = -1
let contexts: Record<'lights' | 'glow', CanvasRenderingContext2D> | undefined

const positions = computed(() => layoutPositions(props.layout))

// a lone matrix keeps its proportions; anything else gets the square the layout space is
const shape = computed(() => {
  const [only, ...rest] = props.layout.segments
  return rest.length === 0 && only.kind === 'matrix' ? only.width / only.height : 1
})

onMounted(() => {
  contexts = { lights: lights.value!.getContext('2d')!, glow: glow.value!.getContext('2d')! }
})

useResizeObserver(root, ([entry]) => {
  cssBox = entry.contentRect
  fit()
})

watch(() => props.layout, layOut, { deep: true })

useVisibleFrames(root, draw)

/** Sizes the backing stores to the box at the current density. A density change alone (another display, page zoom) fires no resize, so a draw checks for it. */
function fit() {
  dpr = devicePixelRatio
  w = Math.round(cssBox.width * dpr)
  h = Math.round(cssBox.height * dpr)
  for (const canvas of [lights.value!, glow.value!]) {
    canvas.width = w
    canvas.height = h
  }
  layOut()
}

/** Fits the layout into the current box: where the LEDs go, how big they are and how far their glow reaches. */
function layOut() {
  drawnRevision = -1
  if (!w || !h) return
  // the pane clamps very wide and very tall shapes, so the LEDs get the largest box of their own shape that fits
  const margin = Math.min(w, h) * 0.05
  box.width = Math.min(w - 2 * margin, (h - 2 * margin) * shape.value)
  box.height = box.width / shape.value
  box.left = (w - box.width) / 2
  box.top = (h - box.height) / 2
  const spacing = Math.min(...props.layout.segments.map((segment) => pitch(segment, box.width, box.height)))
  box.radius = Math.max(dpr, Math.min(spacing * 0.36, 12 * dpr))
  blur.value = Math.round(Math.max(2, Math.min(spacing, box.radius * 4) * 0.55 / dpr))
}

/** Draws the engine's latest LED frame (4 header bytes, then RGB triplets) with every LED where the layout puts it, unless it is the one already drawn. */
function draw() {
  const frame = engine.ledFrame()
  const revision = engine.ledRevision()
  if (devicePixelRatio !== dpr) fit()
  if (!frame || !contexts || revision === drawnRevision || !w || !h) return
  drawnRevision = revision
  const ctx = contexts.lights
  ctx.clearRect(0, 0, w, h)
  const p = positions.value
  const n = Math.min(p.length / 4, (frame.length - 4) / 3)
  for (let i = 0; i < n; i++) {
    // an unlit LED stays faintly visible, so the shape of the device reads in the dark
    const r = Math.max(22, SEEN[frame[4 + i * 3]])
    const g = Math.max(22, SEEN[frame[5 + i * 3]])
    const b = Math.max(22, SEEN[frame[6 + i * 3]])
    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.beginPath()
    ctx.arc(box.left + p[i * 4] * box.width, box.top + (1 - p[i * 4 + 1]) * box.height, box.radius, 0, 2 * Math.PI)
    ctx.fill()
  }

  contexts.glow.clearRect(0, 0, w, h)
  contexts.glow.drawImage(lights.value!, 0, 0)
}

/** Distance between neighboring LEDs of a segment, in pixels of a box the layout space is stretched over. */
function pitch(segment: Segment, width: number, height: number): number {
  if (segment.kind === 'matrix') return Math.min(width / segment.width, height / segment.height)
  if (segment.kind === 'strip') return Math.hypot((segment.to[0] - segment.from[0]) * width, (segment.to[1] - segment.from[1]) * height) / segment.count
  if (segment.kind === 'ring') return 2 * Math.PI * segment.radius * Math.min(width, height) / segment.count
  return Math.sqrt(width * height / segment.points.length)
}
</script>

<template>
  <div ref="root" class="led-map relative overflow-hidden bg-black" :style="{ aspectRatio: Math.min(3, Math.max(0.75, shape)) }">
    <!-- the glow is the same picture blurred by the compositor, which costs nothing per LED -->
    <canvas ref="glow" class="absolute inset-0 size-full" :style="{ filter: `blur(${blur}px) brightness(1.6)` }" />
    <canvas ref="lights" class="absolute inset-0 size-full" />
  </div>
</template>
