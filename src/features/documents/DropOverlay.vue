<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { until } from '@vueuse/core'
import { importData } from '@/lib/app/settings/config'
import { applyDrop, dragHint, graphImageDrop, planDrop, type DropTargets } from '@/lib/app/files/file-drop'
import { workspace } from '@/lib/app/workspace'
import { documentSessions } from '@/lib/documents/sessions/document-session'
import { useEngine } from '@/lib/engine/engine'

const router = useRouter()
const hint = ref<string | null>(null)
// dragenter and dragleave fire for every element the pointer crosses; the drag has left the window when they balance out
let depth = 0

// links between nodes, dock splitters and text selections are drags too, and none of them carries files
const carriesFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')

function showHint(e: DragEvent) {
  hint.value = dragHint([...e.dataTransfer!.items].filter((item) => item.kind === 'file').map((item) => item.type), workspace.mode)
}

function onDragEnter(e: DragEvent) {
  if (!carriesFiles(e)) return
  e.preventDefault()
  depth++
  showHint(e)
}

function onDragOver(e: DragEvent) {
  if (!carriesFiles(e)) return
  // without this the browser refuses the drop here and opens the file in place of the app
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'copy'
  if (hint.value === null) showHint(e)
}

function onDragLeave(e: DragEvent) {
  if (!carriesFiles(e)) return
  depth = Math.max(0, depth - 1)
  if (!depth) hint.value = null
}

const engine = useEngine()
const targets: DropTargets = {
  mode: () => workspace.mode,
  async openPage(mode) {
    await router.push(mode === 'graph' ? '/graph' : '/')
    // a page creates its document when it is mounted, which for a lazy route is after the navigation
    return until(() => documentSessions[mode]).toBeTruthy({ timeout: 3000 })
  },
  imageDrop: () => until(graphImageDrop).toBeTruthy({ timeout: 3000 }),
  useImage: (file) => engine.useImage(file),
  addImage: (blob, name) => engine.images.add(blob, name),
  useSong: (file) => engine.useSong(file),
  playFromFile: () => engine.audio.configure({ source: 'file' }),
  importData,
}

async function onDrop(e: DragEvent) {
  if (!carriesFiles(e)) return
  e.preventDefault()
  // the code editor would insert a dropped text file at the pointer as well
  e.stopPropagation()
  depth = 0
  hint.value = null
  await applyDrop(planDrop([...e.dataTransfer!.files]), { x: e.clientX, y: e.clientY }, targets)
}

const listeners = { dragenter: onDragEnter, dragover: onDragOver, dragleave: onDragLeave, drop: onDrop }
for (const [type, listener] of Object.entries(listeners)) window.addEventListener(type, listener as EventListener, true)
onBeforeUnmount(() => {
  for (const [type, listener] of Object.entries(listeners)) window.removeEventListener(type, listener as EventListener, true)
})
</script>

<template>
  <div
    v-if="hint"
    class="drop-overlay pointer-events-none fixed inset-0 z-[70] flex items-center justify-center border border-primary/60 bg-(--app-surface)/70"
    role="status"
  >
    <span class="rounded-[6px] border border-(--app-hairline) bg-(--app-floating) px-3 py-1.5 text-[13px] text-default shadow-lg">{{ hint }}</span>
  </div>
</template>
