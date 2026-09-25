<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import DropdownField from '@/features/node-ui/fields/DropdownField.vue'
import { useEngine } from '@/lib/engine/engine'
import { systemAudioBlocked } from '@/lib/audio/service'
import { report } from '@/lib/app/logs'
import '@/features/node-ui/node.css'
import '@/features/node-ui/fields/fields.css'
import './bodies.css'

// every node body gets these; this one reads the shared audio service instead
defineProps<{ nodeId: string; values: Record<string, unknown> }>()

const engine = useEngine()
const { audio } = engine
const songInput = ref<HTMLInputElement>()

function onSong(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) void engine.useSong({ blob: file, name: file.name })
}
const canvas = ref<HTMLCanvasElement>()
const wave = new Float32Array(512)
let raf = 0
let visible = true
let observer: IntersectionObserver | undefined

const devices = computed(() => [{ value: '', label: 'Default input' }, ...audio.state.devices.map((d) => ({ value: d.deviceId, label: d.label }))])

function draw() {
  raf = requestAnimationFrame(draw)
  const el = canvas.value
  // an off-screen node or a hidden tab has nobody to draw for
  if (!el || !visible || document.hidden) return
  const ctx = el.getContext('2d')!
  const { width, height } = el
  ctx.clearRect(0, 0, width, height)

  const bands = audio.textures.bands
  const count = audio.textures.bandCount
  ctx.fillStyle = '#4772b3'
  for (let i = 0; i < count; i++) {
    const h = (bands[i] / 255) * height
    ctx.fillRect((i / count) * width, height - h, Math.max(1, width / count - 1), h)
  }

  audio.textures.recent(wave)
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i < wave.length; i++) {
    const y = height / 2 - wave[i] * (height / 2 - 1)
    if (i === 0) ctx.moveTo(0, y)
    else ctx.lineTo((i / (wave.length - 1)) * width, y)
  }
  ctx.stroke()

  // the beat clock as a sweeping marker: it should land on the edge with every beat
  if (audio.features) {
    ctx.fillStyle = audio.features.beatPhase < 0.12 ? '#ffd84a' : 'rgb(255 255 255 / 0.35)'
    ctx.fillRect(audio.features.beatPhase * (width - 3), 0, 3, 4)
  }
}

onMounted(() => {
  observer = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting))
  observer.observe(canvas.value!)
  void audio.refreshDevices().catch((e) => report(e, 'Audio inputs could not be listed'))
  raf = requestAnimationFrame(draw)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  observer?.disconnect()
})
</script>

<template>
  <div class="nui-block nui-audio nodrag">
    <canvas ref="canvas" class="nui-audio-canvas" width="240" height="64" />
    <div class="nui-inline">
      <button type="button" class="nui-button nui-audio-play" @click="audio.toggle()">{{ audio.state.playing ? 'Pause' : 'Start' }}</button>
      <span class="nui-implicit">{{ audio.state.sampleRate ? `${audio.state.sampleRate} Hz` : 'not started' }}</span>
    </div>
    <div v-if="audio.state.settings.source === 'file'" class="nui-inline">
      <button type="button" class="nui-button nui-audio-choose" @click="songInput?.click()">Choose Song...</button>
      <span class="nui-implicit nui-audio-file" :title="audio.state.fileName">{{ audio.state.fileName }}</span>
      <input ref="songInput" type="file" accept="audio/*" hidden @change="onSong">
    </div>
    <DropdownField
      v-if="audio.state.settings.source === 'device'"
      :model-value="audio.state.settings.deviceId"
      :options="devices"
      label="Capture device"
      @update:model-value="audio.configure({ deviceId: $event })"
    />
    <template v-if="audio.state.settings.source === 'loopback'">
      <p v-if="systemAudioBlocked()" class="nui-note is-error">{{ systemAudioBlocked() }}</p>
      <template v-else>
        <p class="nui-note">Chrome shares audio only from a Chrome tab on macOS, and from a tab or the whole screen on Windows: pick one and leave "Share audio" on.</p>
        <button v-if="audio.state.sharePrompt || !audio.state.playing" type="button" class="nui-button nui-audio-play" @click="audio.shareSystemAudio()">Share Audio...</button>
      </template>
    </template>
    <p v-if="audio.state.error" class="nui-note is-error">{{ audio.state.error }}</p>
  </div>
</template>
