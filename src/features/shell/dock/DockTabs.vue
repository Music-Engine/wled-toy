<script setup lang="ts">
import { computed } from 'vue'
import { contextMenuItems } from '@/lib/app/commands'
import { activeTab, dockHost, moveTab, selectTab, visibleTabs, workspace, type DockId, type TabId } from '@/lib/app/workspace'

const props = defineProps<{ dock: DockId }>()

const tabs = computed(() => visibleTabs(props.dock))
const active = computed(() => activeTab(props.dock))
const hideItems = computed(() => contextMenuItems([[props.dock === 'right' ? 'view.hideDock' : 'view.hideBottom']]))

function tabMenu(id: TabId) {
  return [
    [{ label: props.dock === 'right' ? 'Move to bottom panel' : 'Move to side panel', onSelect: () => moveTab(id, props.dock === 'right' ? 'bottom' : 'right') }],
    ...hideItems.value,
  ]
}

function adopt(id: TabId, parent: unknown, part: 'body' | 'actions' = 'body') {
  const host = dockHost(id, part)
  // re-appending a node that is already here would detach it for a moment and drop its scroll position and focus
  if (parent instanceof HTMLElement && host.parentElement !== parent) parent.append(host)
}
</script>

<template>
  <div class="dock-tabs flex min-h-0 flex-col" :data-dock="dock">
    <div class="flex h-(--app-header-h) shrink-0 items-stretch border-b border-(--app-hairline) bg-(--app-chrome) ps-1" role="tablist">
      <UContextMenu
        v-for="tab in tabs"
        :key="tab.id"
        :items="tabMenu(tab.id)"
      >
        <button
          type="button"
          role="tab"
          class="dock-tab relative shrink-0 px-2.5 text-[12px] font-medium"
          :class="tab.id === active ? 'text-highlighted after:absolute after:inset-x-1.5 after:bottom-0 after:h-0.5 after:bg-primary' : 'text-muted hover:text-default'"
          :data-tab="tab.id"
          :aria-selected="tab.id === active"
          @click="selectTab(tab.id)"
        >
          {{ tab.label }}<span v-if="tab.id === 'problems' && workspace.problemCount" class="ms-1.5 tabular-nums">{{ workspace.problemCount }}</span>
        </button>
      </UContextMenu>
      <div class="ms-auto flex items-center gap-1 pe-1">
        <div v-if="active" :key="active" :ref="(el) => adopt(active!, el, 'actions')" class="dock-actions" />
        <slot name="actions" />
      </div>
    </div>
    <div class="min-h-0 flex-1">
      <div
        v-for="tab in tabs"
        v-show="tab.id === active"
        :key="tab.id"
        :ref="(body) => adopt(tab.id, body)"
        class="dock-body h-full overflow-auto"
        role="tabpanel"
      />
      <p v-if="!tabs.length" class="px-2.5 py-2 text-[12px] text-dimmed">No panels here. Right-click a tab in the {{ dock === 'right' ? 'bottom panel' : 'side panel' }} to move it over.</p>
    </div>
  </div>
</template>
