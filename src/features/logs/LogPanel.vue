<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { contextMenuItems } from '@/lib/app/commands'
import { clearLogs, logContext as contextEntry, logFilter as filter, logs, logTimeFormat as timeFormat, shownLogs as shown } from '@/lib/app/logs'
import { dockHost } from '@/lib/app/workspace'

const list = ref<HTMLElement>()
const pinned = ref(true)

function onScroll() {
  const el = list.value!
  // a hidden tab has no height and would read as "scrolled away"
  if (el.clientHeight) pinned.value = el.scrollHeight - el.scrollTop - el.clientHeight < 4
}

function follow() {
  if (pinned.value && list.value) list.value.scrollTop = list.value.scrollHeight
}

// the list, not its length: a full log drops its oldest entry for every new one and stays the same length
watch([shown, filter], () => void nextTick(follow))
// covers the tab being shown again and the panel being resized
useResizeObserver(list, follow)

const menu = computed(() => contextMenuItems([['log.copyLine', 'log.copyAll'], ['log.clear']]))
</script>

<template>
  <UContextMenu :items="menu">
    <ol ref="list" class="log-panel h-full select-text overflow-y-auto font-mono text-[12px] leading-5" @scroll.passive="onScroll">
      <li
        v-for="entry in shown"
        :key="entry.id"
        class="flex min-h-5 gap-2 px-2.5 hover:bg-(--app-hover)"
        :data-level="entry.level"
        @contextmenu="contextEntry = entry"
      >
        <time class="shrink-0 tabular-nums text-dimmed">{{ timeFormat.format(entry.time) }}</time>
        <span class="min-w-0 whitespace-pre-wrap break-words" :class="entry.level === 'error' ? 'text-error' : entry.level === 'warn' ? 'text-warning' : 'text-default'">{{ entry.message }}</span>
      </li>
      <li v-if="!shown.length" class="px-2.5 font-sans text-dimmed">{{ logs.length ? 'Nothing at this level' : 'No log entries' }}</li>
    </ol>
  </UContextMenu>

  <Teleport :to="dockHost('log', 'actions')">
    <div class="log-filter flex items-center" role="group" aria-label="Log level">
      <button
        v-for="option in [{ value: 'all', label: 'All' }, { value: 'warn', label: 'Warnings' }, { value: 'error', label: 'Errors' }] as const"
        :key="option.value"
        type="button"
        class="app-button border-transparent"
        :class="filter === option.value ? 'bg-accented text-highlighted' : 'text-muted'"
        :aria-pressed="filter === option.value"
        :data-level="option.value"
        @click="filter = option.value"
      >
        {{ option.label }}
      </button>
    </div>
    <button type="button" class="app-button log-clear ms-1" :disabled="!logs.length" @click="clearLogs">Clear</button>
  </Teleport>
</template>
