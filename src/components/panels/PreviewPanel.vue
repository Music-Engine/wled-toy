<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from 'vue'
import LedMap from './LedMap.vue'
import { useEngine } from '@/lib/engine/engine'
import { config } from '@/lib/app/config'
import { contextMenuItems } from '@/lib/app/commands'
import { layoutPositions } from '@/lib/engine/layout'
import { workspace, type PreviewView } from '@/lib/app/workspace'

const menu = computed(() => contextMenuItems([['playback.resetTime', 'playback.toggleAudio', 'output.toggleStream']]))

const engine = useEngine()
const host = ref<HTMLDivElement>()

// with a layout the LEDs are wherever it puts them; without one they sit on the scanline
const ledDots = computed(() => {
  if (!config.layout) return []
  const p = layoutPositions(config.layout)
  return Array.from({ length: p.length / 4 }, (_, i) => ({ x: p[i * 4] * 100, y: (1 - p[i * 4 + 1]) * 100 }))
})

const summary = computed(() => (config.layout
  ? config.layout.segments.map((s) => (s.kind === 'matrix' ? `matrix ${s.width}x${s.height}` : s.kind)).join(', ')
  : `y ${config.scanY.toFixed(2)}`))

const VIEWS: { id: PreviewView; label: string; title: string }[] = [
  { id: 'render', label: 'Render', title: 'The shader, with the LEDs marked where they sample it' },
  { id: 'leds', label: 'LEDs', title: 'The LEDs alone, lit, where the layout puts them' },
]
// a device without a layout is a row of LEDs, which the strip monitor already shows
const showLeds = computed(() => !!config.layout && workspace.previewView === 'leds')

// the engine skips the preview render while its canvas is out of the document
onMounted(() => watchEffect(() => (showLeds.value ? engine.canvas.remove() : host.value!.prepend(engine.canvas))))
</script>

<template>
  <UContextMenu :items="menu">
    <div class="preview-panel border-b border-(--app-hairline)">
      <div class="flex h-(--app-header-h) items-center gap-2 border-b border-(--app-hairline) bg-(--app-chrome) px-2.5 text-[12px]">
        <span class="font-medium text-highlighted">Preview</span>
        <span class="ms-auto truncate tabular-nums text-muted">{{ summary }}</span>
        <div v-if="config.layout" class="flex shrink-0" role="group" aria-label="Preview view">
          <button
            v-for="view in VIEWS"
            :key="view.id"
            type="button"
            class="app-button first:rounded-e-none last:rounded-s-none last:border-s-0"
            :class="workspace.previewView === view.id ? 'bg-(--app-selected) text-highlighted' : 'text-muted'"
            :title="view.title"
            :aria-pressed="workspace.previewView === view.id"
            @click="workspace.previewView = view.id"
          >
            {{ view.label }}
          </button>
        </div>
      </div>
      <LedMap v-if="showLeds" :layout="config.layout!" />
      <div v-show="!showLeds" ref="host" class="relative overflow-hidden bg-black">
        <template v-if="config.layout">
          <span
            v-for="(dot, i) in ledDots"
            :key="i"
            class="pointer-events-none absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-white/80"
            :style="{ left: `${dot.x}%`, top: `${dot.y}%` }"
          />
        </template>
        <div v-else class="pointer-events-none absolute inset-x-0 h-px bg-white/70 shadow-[0_0_6px_white]" :style="{ top: `${(1 - config.scanY) * 100}%` }" />
      </div>
    </div>
  </UContextMenu>
</template>
