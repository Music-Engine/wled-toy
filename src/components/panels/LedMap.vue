<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useEngine } from '@/lib/engine/engine'
import { layoutPositions, type Layout, type Segment } from '@/lib/engine/layout'
import { SEEN } from './led-colors'

const props = defineProps<{ layout: Layout }>()
const lights = ref<HTMLCanvasElement>()
const glow = ref<HTMLCanvasElement>()
const blur = ref(0)
let unsubscribe: (() => void) | undefined

const positions = computed(() => layoutPositions(props.layout))

// a lone matrix keeps its proportions; anything else gets the square the layout space is
const shape = computed(() => {
  const [only, ...rest] = props.layout.segments
  return rest.length === 0 && only.kind === 'matrix' ? only.width / only.height : 1
})

/** Distance between neighboring LEDs of a segment, in pixels of a box the layout space is stretched over. */
function pitch(segment: Segment, width: number, height: number): number {
  if (segment.kind === 'matrix') return Math.min(width / segment.width, height / segment.height)
  if (segment.kind === 'strip') return Math.hypot((segment.to[0] - segment.from[0]) * width, (segment.to[1] - segment.from[1]) * height) / segment.count
  if (segment.kind === 'ring') return 2 * Math.PI * segment.radius * Math.min(width, height) / segment.count
  return Math.sqrt(width * height / segment.points.length)
}

/** Draws a frame from ShaderRenderer.renderLeds (4 header bytes, then RGB triplets) with every LED where the layout puts it. */
function draw(frame: Uint8Array) {
  const el = lights.value
  const ctx = el?.getContext('2d')
  if (!el || !ctx || !glow.value) return
  const w = Math.round(el.clientWidth * devicePixelRatio)
  const h = Math.round(el.clientHeight * devicePixelRatio)
  if (!w || !h) return
  for (const canvas of [el, glow.value]) {
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
  }

  // the pane clamps very wide and very tall shapes, so the LEDs get the largest box of their own shape that fits
  const margin = Math.min(w, h) * 0.05
  const boxW = Math.min(w - 2 * margin, (h - 2 * margin) * shape.value)
  const boxH = boxW / shape.value
  const [left, top] = [(w - boxW) / 2, (h - boxH) / 2]
  const spacing = Math.min(...props.layout.segments.map((segment) => pitch(segment, boxW, boxH)))
  const radius = Math.max(devicePixelRatio, Math.min(spacing * 0.36, 12 * devicePixelRatio))
  blur.value = Math.round(Math.max(2, Math.min(spacing, radius * 4) * 0.55 / devicePixelRatio))

  ctx.clearRect(0, 0, w, h)
  const p = positions.value
  const n = Math.min(p.length / 4, (frame.length - 4) / 3)
  for (let i = 0; i < n; i++) {
    // an unlit LED stays faintly visible, so the shape of the device reads in the dark
    const [r, g, b] = [0, 1, 2].map((c) => Math.max(22, SEEN[frame[4 + i * 3 + c]]))
    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.beginPath()
    ctx.arc(left + p[i * 4] * boxW, top + (1 - p[i * 4 + 1]) * boxH, radius, 0, 2 * Math.PI)
    ctx.fill()
  }

  const halo = glow.value.getContext('2d')!
  halo.clearRect(0, 0, w, h)
  halo.drawImage(el, 0, 0)
}

onMounted(() => {
  unsubscribe = useEngine().onLedFrame(draw)
})

onBeforeUnmount(() => unsubscribe?.())
</script>

<template>
  <div class="led-map relative overflow-hidden bg-black" :style="{ aspectRatio: Math.min(3, Math.max(0.75, shape)) }">
    <!-- the glow is the same picture blurred by the compositor, which costs nothing per LED -->
    <canvas ref="glow" class="absolute inset-0 size-full" :style="{ filter: `blur(${blur}px) brightness(1.6)` }" />
    <canvas ref="lights" class="absolute inset-0 size-full" />
  </div>
</template>
