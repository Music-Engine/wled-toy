<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { until } from '@vueuse/core'
import { importData } from '@/lib/app/config'
import { classifyFile, dragHint, graphImageDrop, isConfigExport, isGraphEnvelope, planDrop } from '@/lib/app/file-drop'
import { log, report } from '@/lib/app/logs'
import { launchScreen } from '@/lib/app/preferences'
import { workspace } from '@/lib/app/workspace'
import { documentSessions } from '@/lib/documents/document-session'
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

async function openDocument(mode: 'graph' | 'shader', file: File) {
  const text = await file.text()
  await router.push(mode === 'graph' ? '/graph' : '/')
  // a page creates its document when it is mounted, which for a lazy route is after the navigation
  const session = await until(() => documentSessions[mode]).toBeTruthy({ timeout: 3000 })
  if (!session) return log(`${file.name} was not opened: ${mode} mode did not come up`, 'error')
  // a dropped file comes without a handle to write back to, so it opens under its name and Save asks where to put it
  await session.openFile({ name: file.name, text })
}

async function useAsImage(file: File, at: { x: number; y: number }) {
  const engine = useEngine()
  if (workspace.mode !== 'graph') {
    await engine.useImage({ blob: file, name: file.name })
    return log(`Using your image: ${file.name}`)
  }
  const addNode = await until(graphImageDrop).toBeTruthy({ timeout: 3000 })
  if (!addNode) return log(`${file.name} was not added: the graph is not ready`, 'error')
  const image = await engine.images.add(file, file.name)
  addNode(image.id, image.name, at)
}

async function useAsTrack(file: File) {
  const engine = useEngine()
  // a file that is not playable audio is refused in there, with an error line the status bar shows
  if (!(await engine.useSong({ blob: file, name: file.name }))) return
  await engine.audio.configure({ source: 'file' })
  log(`Using your song: ${file.name}`)
}

async function importSettings(file: File) {
  const raw: unknown = await file.text().then(JSON.parse).catch((error) => report(error, `${file.name} could not be read as JSON`))
  if (isGraphEnvelope(raw)) return openDocument('graph', file)
  if (!isConfigExport(raw)) return log(`${file.name} is not a WLEDtoy settings file`, 'warn')
  log(`Imported ${file.name} (${Object.keys(importData(raw)).join(', ') || 'nothing usable'})`)
}

async function onDrop(e: DragEvent) {
  if (!carriesFiles(e)) return
  e.preventDefault()
  // the code editor would insert a dropped text file at the pointer as well
  e.stopPropagation()
  depth = 0
  hint.value = null
  const at = { x: e.clientX, y: e.clientY }
  const plan = planDrop([...e.dataTransfer!.files])
  for (const file of plan.unknown) log(`${file.name} was not opened: WLEDtoy takes audio, images, .wledgraph, .glsl and settings files`, 'warn')
  for (const file of plan.skipped) log(`Skipped ${file.name}: one ${classifyFile(file)} file per drop`, 'warn')
  if (plan.steps.length) launchScreen.open = false
  for (const { kind, file } of plan.steps) {
    try {
      if (kind === 'audio') await useAsTrack(file)
      else if (kind === 'image') await useAsImage(file, at)
      else if (kind === 'config') await importSettings(file)
      else await openDocument(kind, file)
    } catch (err) {
      report(err, `${file.name} could not be used`)
    }
  }
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
