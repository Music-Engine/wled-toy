<script setup lang="ts">
import AppMenuBar from '@/features/commands/AppMenuBar.vue'
import { useEngine } from '@/lib/engine/engine'
import { acceleratorKbds, commandTitle, getCommand, hasNativeMenu, isEnabled, isMac, runCommand } from '@/lib/app/commands'
import { activeDocument } from '@/lib/documents/document-session'
import { isTauri } from '@/lib/app/platform'
import { workspace } from '@/lib/app/workspace'

const streaming = useEngine().streaming

// only the macOS overlay title bar drags the window; Windows and Linux keep native decorations, and in a browser tab this is a plain toolbar
const drag = isTauri() && isMac() ? '' : undefined

const modeTabs = (['shader', 'graph', 'reference'] as const).map((mode) => ({ mode, id: `mode.${mode}`, title: commandTitle(getCommand(`mode.${mode}`)!) }))

const kbds = (id: string) => acceleratorKbds(getCommand(id)!.accelerator!)
</script>

<template>
  <header
    class="titlebar relative flex h-(--app-titlebar-h) shrink-0 items-center gap-2 border-b border-(--app-hairline) bg-(--app-chrome) px-2"
    :data-tauri-drag-region="drag"
  >
    <div v-if="drag === ''" class="traffic-spacer w-[78px] shrink-0 self-stretch" data-tauri-drag-region />

    <AppMenuBar v-if="!hasNativeMenu()" />

    <div class="flex min-w-0 flex-1 items-center self-stretch ps-2 text-[12px]" :data-tauri-drag-region="drag">
      <span v-if="activeDocument" class="document-name truncate text-muted" :data-tauri-drag-region="drag">
        {{ activeDocument.name.value }}<span v-if="activeDocument.store.dirty.value" class="document-dirty text-dimmed"> · Edited</span>
      </span>
    </div>
    <div class="mode-tabs flex h-[26px] shrink-0 items-stretch gap-0.5 rounded-[4px] border border-accented p-0.5 text-[12px]" role="tablist" aria-label="Mode">
      <UTooltip v-for="tab in modeTabs" :key="tab.mode" :text="`${tab.title} mode`" :kbds="kbds(tab.id)">
        <button
          type="button"
          role="tab"
          class="rounded-[3px] px-2.5 disabled:text-dimmed"
          :class="workspace.mode === tab.mode ? 'bg-accented font-medium text-highlighted' : 'text-muted hover:bg-(--app-hover) hover:text-default'"
          :aria-selected="workspace.mode === tab.mode"
          :disabled="!isEnabled(getCommand(tab.id)!)"
          @click="runCommand(tab.id)"
        >
          {{ tab.title }}
        </button>
      </UTooltip>
    </div>
    <div class="min-w-0 flex-1 self-stretch" :data-tauri-drag-region="drag" />

    <div class="layout-toggles flex shrink-0 items-center gap-1">
      <UTooltip text="Toggle side panel" :kbds="kbds('view.toggleDock')">
        <button
          type="button"
          class="flex size-6 items-center justify-center rounded-[4px] hover:bg-(--app-hover) hover:text-default"
          :class="workspace.dockVisible ? 'bg-accented text-default' : 'text-muted'"
          aria-label="Toggle side panel"
          :aria-pressed="workspace.dockVisible"
          @click="runCommand('view.toggleDock')"
        >
          <UIcon name="i-lucide-panel-right" class="size-4" />
        </button>
      </UTooltip>
      <UTooltip text="Toggle bottom panel" :kbds="kbds('view.toggleBottom')">
        <button
          type="button"
          class="flex size-6 items-center justify-center rounded-[4px] hover:bg-(--app-hover) hover:text-default"
          :class="workspace.bottomVisible ? 'bg-accented text-default' : 'text-muted'"
          aria-label="Toggle bottom panel"
          :aria-pressed="workspace.bottomVisible"
          @click="runCommand('view.toggleBottom')"
        >
          <UIcon name="i-lucide-panel-bottom" class="size-4" />
        </button>
      </UTooltip>
    </div>

    <div v-if="streaming" class="live-hairline pointer-events-none absolute inset-x-0 -bottom-px h-0.5 bg-primary" />
  </header>
</template>
