<script setup lang="ts">
import DockTabs from './DockTabs.vue'
import { workspace } from '@/lib/app/workspace'
</script>

<template>
  <section class="bottom-panel flex min-h-0 shrink-0 flex-col bg-(--app-surface)">
    <DockTabs dock="bottom" class="min-h-0 flex-1">
      <template #actions>
        <button
          type="button"
          class="flex size-5 items-center justify-center rounded-[4px] text-muted hover:bg-(--app-hover) hover:text-default"
          aria-label="Close bottom panel"
          @click="workspace.bottomVisible = false"
        >
          <UIcon name="i-lucide-chevron-down" class="size-4" />
        </button>
      </template>
    </DockTabs>
  </section>
</template>
