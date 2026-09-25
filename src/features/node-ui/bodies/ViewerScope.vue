<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useEngine } from '@/lib/engine/engine'

const props = defineProps<{ nodeId: string; values: Record<string, unknown> }>()

const engine = useEngine()
const canvas = ref<HTMLCanvasElement>()
const history = new Float32Array(240)
let head = 0
let timer: ReturnType<typeof setInterval> | undefined
let raf = 0
let visible = true
let observer: IntersectionObserver | undefined

// sampled on a timer at the LED rate, so a hidden tab keeps the trace honest; drawn only when there is someone to see it
onMounted(() => {
  timer = setInterval(() => {
    const value = engine.controlOutput(props.nodeId, 'value')
    history[head] = typeof value === 'number' ? value : 0
    head = (head + 1) % history.length
  }, 1000 / 30)
  observer = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting))
  observer.observe(canvas.value!)
  const draw = () => {
    raf = requestAnimationFrame(draw)
    const el = canvas.value
    if (!el || !visible || document.hidden) return
    const ctx = el.getContext('2d')!
    const { width, height } = el
    ctx.clearRect(0, 0, width, height)
    ctx.strokeStyle = 'rgb(255 255 255 / 0.15)'
    ctx.beginPath()
    ctx.moveTo(0, height / 2)
    ctx.lineTo(width, height / 2)
    ctx.stroke()
    ctx.strokeStyle = '#63c763'
    ctx.beginPath()
    for (let i = 0; i < history.length; i++) {
      const v = history[(head + i) % history.length]
      const y = height - 2 - Math.min(1, Math.max(0, v)) * (height - 4)
      if (i === 0) ctx.moveTo(0, y)
      else ctx.lineTo((i / (history.length - 1)) * width, y)
    }
    ctx.stroke()
    const latest = history[(head + history.length - 1) % history.length]
    ctx.fillStyle = '#fff'
    ctx.font = '11px sans-serif'
    ctx.fillText(latest.toFixed(3), 4, 12)
  }
  raf = requestAnimationFrame(draw)
})
onBeforeUnmount(() => {
  clearInterval(timer)
  cancelAnimationFrame(raf)
  observer?.disconnect()
})
</script>

<template>
  <div class="nui-block">
    <canvas ref="canvas" class="nui-audio-canvas" width="240" height="64" />
  </div>
</template>
