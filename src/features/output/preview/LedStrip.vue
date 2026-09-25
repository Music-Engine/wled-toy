<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { config } from '@/lib/app/config'
import { useEngine } from '@/lib/engine/engine'
import { SEEN } from './led-colors'

const canvas = ref<HTMLCanvasElement>()
// one pixel per LED; stretched smooth it is the glow, stretched hard it is the lights of a dense strip
const lights = document.createElement('canvas')
let unsubscribe: (() => void) | undefined

/** Draws a frame from ShaderRenderer.renderLeds (4 header bytes, then RGB triplets). */
function draw(frame: Uint8Array) {
  const el = canvas.value
  const ctx = el?.getContext('2d')
  if (!el || !ctx) return
  const w = Math.round(el.clientWidth * devicePixelRatio)
  const h = Math.round(el.clientHeight * devicePixelRatio)
  if (!w || !h) return
  if (el.width !== w || el.height !== h) {
    el.width = w
    el.height = h
  }
  const n = Math.min(config.ledCount, (frame.length - 4) / 3)
  if (n < 1) return
  if (lights.width !== n) {
    lights.width = n
    lights.height = 1
  }
  const pixels = new ImageData(n, 1)
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) pixels.data[i * 4 + c] = SEEN[frame[4 + i * 3 + c]]
    pixels.data[i * 4 + 3] = 255
  }
  lights.getContext('2d')!.putImageData(pixels, 0, 0)

  ctx.imageSmoothingEnabled = true
  ctx.drawImage(lights, 0, 0, w, h)
  const falloff = ctx.createLinearGradient(0, 0, 0, h)
  falloff.addColorStop(0, '#000')
  falloff.addColorStop(0.5, 'rgb(0 0 0 / 0.3)')
  falloff.addColorStop(1, '#000')
  ctx.fillStyle = falloff
  ctx.fillRect(0, 0, w, h)

  const cell = w / n
  if (cell < 4 * devicePixelRatio) {
    // too dense for single lights: one bar per LED, edge to edge
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(lights, 0, Math.round(h * 0.36), w, Math.round(h * 0.28))
    return
  }
  const width = cell * 0.6
  const height = Math.min(h * 0.36, width * 2.4)
  ctx.shadowBlur = width
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = ctx.shadowColor = `rgb(${pixels.data[i * 4]},${pixels.data[i * 4 + 1]},${pixels.data[i * 4 + 2]})`
    ctx.beginPath()
    ctx.roundRect(cell * i + (cell - width) / 2, (h - height) / 2, width, height, width * 0.3)
    ctx.fill()
  }
  ctx.shadowBlur = 0
}

onMounted(() => {
  unsubscribe = useEngine().onLedFrame(draw)
})

onBeforeUnmount(() => unsubscribe?.())
</script>

<template>
  <canvas ref="canvas" class="led-monitor block h-16 w-full shrink-0 border-t border-(--app-hairline) bg-black" />
</template>
