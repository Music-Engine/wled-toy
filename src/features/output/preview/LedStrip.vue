<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { config } from '@/lib/app/settings/config'
import { useEngine } from '@/lib/engine/engine'
import { SEEN } from './led-colors'
import { useVisibleFrames } from './use-visible-frames'

const engine = useEngine()
const root = ref<HTMLElement>()
const backdrop = ref<HTMLCanvasElement>()
const glow = ref<HTMLCanvasElement>()
const lights = ref<HTMLCanvasElement>()
const blur = ref(0)
// one pixel per LED; stretched smooth it is the backdrop, stretched hard it is the lights
const strip = document.createElement('canvas')
// opaque where a light is, so the hard stretched strip keeps only the light shapes
const mask = document.createElement('canvas')
let pixels = new ImageData(1, 1)
let falloff: CanvasGradient | undefined
let dense = false
let [w, h, dpr] = [0, 0, 1]
let cssBox = { width: 0, height: 0 }
// the LED count the mask, glow and falloff were laid out for; 0 lays them out again on the next draw
let laidOut = 0
let drawnRevision = -1
let contexts: Record<'backdrop' | 'glow' | 'lights' | 'strip', CanvasRenderingContext2D> | undefined

onMounted(() => {
  contexts = {
    backdrop: backdrop.value!.getContext('2d')!,
    glow: glow.value!.getContext('2d')!,
    lights: lights.value!.getContext('2d')!,
    strip: strip.getContext('2d')!,
  }
})

useResizeObserver(root, ([entry]) => {
  cssBox = entry.contentRect
  fit()
})

useVisibleFrames(root, draw)

/** Sizes the backing stores to the box at the current density. A density change alone (another display, page zoom) fires no resize, so a draw checks for it. */
function fit() {
  dpr = devicePixelRatio
  w = Math.round(cssBox.width * dpr)
  h = Math.round(cssBox.height * dpr)
  for (const canvas of [backdrop.value!, glow.value!, lights.value!]) {
    canvas.width = w
    canvas.height = h
  }
  laidOut = 0
  drawnRevision = -1
}

/** Draws the engine's latest LED frame (4 header bytes, then RGB triplets) unless it is the one already drawn. */
function draw() {
  const frame = engine.ledFrame()
  const revision = engine.ledRevision()
  if (devicePixelRatio !== dpr) fit()
  if (!frame || !contexts || revision === drawnRevision || !w || !h) return
  const n = Math.min(config.ledCount, (frame.length - 4) / 3)
  if (n < 1) return
  if (n !== laidOut) layOut(n)
  drawnRevision = revision
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) pixels.data[i * 4 + c] = SEEN[frame[4 + i * 3 + c]]
  }
  contexts.strip.putImageData(pixels, 0, 0)

  const back = contexts.backdrop
  back.imageSmoothingEnabled = true
  back.drawImage(strip, 0, 0, w, h)
  back.fillStyle = falloff!
  back.fillRect(0, 0, w, h)

  const lit = contexts.lights
  lit.clearRect(0, 0, w, h)
  lit.imageSmoothingEnabled = false
  if (dense) {
    lit.drawImage(strip, 0, Math.round(h * 0.36), w, Math.round(h * 0.28))
    return
  }
  lit.drawImage(strip, 0, 0, w, h)
  lit.globalCompositeOperation = 'destination-in'
  lit.drawImage(mask, 0, 0)
  lit.globalCompositeOperation = 'source-over'
  contexts.glow.clearRect(0, 0, w, h)
  contexts.glow.drawImage(lights.value!, 0, 0)
}

/** Sizes the per-LED buffers for `n` LEDs across the current box and draws the light shapes into the mask. */
function layOut(n: number) {
  laidOut = n
  strip.width = n
  strip.height = 1
  pixels = new ImageData(n, 1)
  for (let i = 0; i < n; i++) pixels.data[i * 4 + 3] = 255
  falloff = contexts!.backdrop.createLinearGradient(0, 0, 0, h)
  falloff.addColorStop(0, '#000')
  falloff.addColorStop(0.5, 'rgb(0 0 0 / 0.3)')
  falloff.addColorStop(1, '#000')
  contexts!.glow.clearRect(0, 0, w, h)

  const cell = w / n
  // too dense for single lights: one bar per LED, edge to edge, without a glow
  dense = cell < 4 * dpr
  if (dense) return
  const width = cell * 0.6
  const height = Math.min(h * 0.36, width * 2.4)
  // the glow used to be a shadowBlur of one light's width, and a shadowBlur is twice the deviation CSS blur takes
  blur.value = width / 2 / dpr
  mask.width = w
  mask.height = h
  const ctx = mask.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  for (let i = 0; i < n; i++) ctx.roundRect(cell * i + (cell - width) / 2, (h - height) / 2, width, height, width * 0.3)
  ctx.fill()
}
</script>

<template>
  <div ref="root" class="led-monitor relative h-16 w-full shrink-0 overflow-hidden border-t border-(--app-hairline) bg-black">
    <canvas ref="backdrop" class="absolute inset-0 size-full" />
    <!-- the glow is the lights blurred by the compositor, which costs nothing per LED -->
    <canvas ref="glow" class="absolute inset-0 size-full" :style="{ filter: `blur(${blur}px)` }" />
    <canvas ref="lights" class="absolute inset-0 size-full" />
  </div>
</template>
