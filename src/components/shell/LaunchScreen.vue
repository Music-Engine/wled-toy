<script setup lang="ts">
import { computed, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { until } from '@vueuse/core'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import AppMark from '@/features/shell/AppMark.vue'
import { getCommand, isEnabled, runCommand } from '@/lib/app/commands'
import { recentId, storedRecentFiles, type RecentFile } from '@/lib/documents/documents'
import { EXAMPLES } from '@/lib/shader/examples'
import { activeGraphDocument } from '@/lib/graph/model/document'
import { launchScreen, preferences } from '@/lib/app/preferences'
import { version } from '@/lib/app/version'

const router = useRouter()

// the graph page owns the list, and on a launch into shader mode it has not been mounted yet: until then the list is what it stored
const recent = computed<RecentFile[]>(() => {
  const store = activeGraphDocument.value?.store
  return (store ? store.recentFiles.value : storedRecentFiles('graph')).slice(0, 8)
})

/** Goes to a mode and runs one of its commands. A page binds its handlers when it is mounted, which for a lazy route is after the navigation. */
async function go(path: string, command?: string) {
  launchScreen.open = false
  await router.push(path)
  if (!command) return
  await nextTick()
  await until(() => isEnabled(getCommand(command)!)).toBe(true, { timeout: 3000 })
  runCommand(command)
}

async function openRecent(file: RecentFile) {
  launchScreen.open = false
  await router.push('/graph')
  const graphDocument = await until(activeGraphDocument).toBeTruthy({ timeout: 3000 })
  await graphDocument?.openRecent(recentId(file))
}
</script>

<template>
  <DialogRoot v-model:open="launchScreen.open">
    <DialogPortal>
      <DialogOverlay class="launch-overlay fixed inset-0 z-50 bg-black/40" />
      <DialogContent
        class="launch-screen dark fixed left-1/2 top-1/2 z-50 w-[min(560px,calc(100vw-40px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[8px] border border-accented bg-elevated text-[13px] text-default shadow-2xl outline-none"
      >
        <header class="flex h-[84px] items-end gap-3 bg-primary px-5 pb-3 text-[#17120f]">
          <AppMark class="size-9" />
          <DialogTitle class="text-[24px] font-semibold leading-none tracking-tight">WLEDtoy</DialogTitle>
          <span class="ms-auto font-mono text-[12px]" data-value="version">{{ version }}</span>
        </header>
        <DialogDescription class="sr-only">Start something new, open a file, or pick up a recent one</DialogDescription>

        <div class="grid grid-cols-2 gap-x-6 px-5 pb-3 pt-1">
          <div>
            <h3 class="launch-heading">New</h3>
            <button type="button" class="launch-row" data-action="new-shader" @click="go('/', 'file.new')">Shader</button>
            <button type="button" class="launch-row" data-action="new-graph" @click="go('/graph', 'file.new')">Graph</button>
            <h3 class="launch-heading">Open</h3>
            <button type="button" class="launch-row" data-action="open" @click="go('/graph', 'file.open')">Open...</button>
          </div>
          <div class="min-w-0">
            <h3 class="launch-heading">Recent Files</h3>
            <button
              v-for="file in recent"
              :key="recentId(file)"
              type="button"
              class="launch-row"
              :title="file.path ?? file.name"
              :data-recent="recentId(file)"
              @click="openRecent(file)"
            >
              {{ file.name }}
            </button>
            <p v-if="!recent.length" class="px-2 py-1 text-dimmed">No recent files</p>
            <h3 class="launch-heading">Examples</h3>
            <button
              v-for="example in EXAMPLES.slice(0, 5)"
              :key="example.name"
              type="button"
              class="launch-row"
              :data-example="example.name"
              @click="go('/', `shader.example.${example.name}`)"
            >
              {{ example.name }}
            </button>
          </div>
        </div>

        <label class="flex h-[34px] items-center gap-2 border-t border-accented px-5 text-[12px] text-muted">
          <input v-model="preferences.showLaunchScreen" type="checkbox" class="accent-(--ui-primary)" data-field="showLaunchScreen">
          Show on launch
        </label>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style>
.launch-heading {
  padding: 12px 8px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ui-text-muted);
}

.launch-row {
  display: block;
  width: 100%;
  height: 24px;
  overflow: hidden;
  border-radius: 4px;
  padding: 0 8px;
  text-align: start;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
  color: var(--ui-text-highlighted);
}

.launch-row:hover,
.launch-row:focus-visible {
  background: var(--ui-primary);
  color: var(--ui-text-inverted);
  outline: none;
}
</style>
