<script setup lang="ts">
import { computed } from 'vue'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  TabsContent,
  TabsList,
  TabsRoot,
  TabsTrigger,
} from 'reka-ui'
import AppearanceSection from './sections/AppearanceSection.vue'
import DataSection from './sections/DataSection.vue'
import DevicesSection from './sections/DevicesSection.vue'
import GeneralSection from './sections/GeneralSection.vue'
import OutputSection from './sections/OutputSection.vue'
import ShortcutsSection from './sections/ShortcutsSection.vue'
import { settingsOpener, settingsView, type SettingsSection } from '@/lib/app/settings/preferences'

const sections: Array<{ id: SettingsSection; label: string; component: unknown }> = [
  { id: 'general', label: 'General', component: GeneralSection },
  { id: 'appearance', label: 'Appearance', component: AppearanceSection },
  { id: 'devices', label: 'Devices', component: DevicesSection },
  { id: 'output', label: 'Output', component: OutputSection },
  { id: 'shortcuts', label: 'Shortcuts', component: ShortcutsSection },
  { id: 'data', label: 'Data', component: DataSection },
]

const current = computed(() => sections.find((section) => section.id === settingsView.section) ?? sections[0])

function onCloseAutoFocus(e: Event) {
  const opener = settingsOpener()
  if (!opener) return
  e.preventDefault()
  opener.focus()
}
</script>

<template>
  <DialogRoot v-model:open="settingsView.open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/40" />
      <DialogContent
        class="settings-view fixed left-1/2 top-1/2 z-50 flex h-[min(620px,calc(100dvh-40px))] w-[min(900px,calc(100vw-40px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[8px] border border-(--pref-line) bg-(--app-floating) text-[13px] text-default shadow-2xl outline-none"
        @close-auto-focus="onCloseAutoFocus"
      >
        <TabsRoot v-model="settingsView.section" orientation="vertical" class="flex min-w-0 flex-1">
          <div class="flex w-[184px] shrink-0 flex-col border-e border-(--pref-line) bg-(--app-chrome)">
            <DialogTitle class="flex h-[52px] shrink-0 items-center px-4 text-[13px] font-semibold text-highlighted">Preferences</DialogTitle>
            <TabsList class="flex flex-col gap-px px-2" aria-label="Preference sections">
              <TabsTrigger
                v-for="section in sections"
                :key="section.id"
                :value="section.id"
                class="settings-tab flex h-[28px] cursor-default items-center rounded-[4px] px-2 text-start text-[13px] text-default outline-none hover:bg-(--app-hover) data-[state=active]:bg-(--app-selected) data-[state=active]:font-medium data-[state=active]:text-highlighted"
              >
                {{ section.label }}
              </TabsTrigger>
            </TabsList>
            <p class="mt-auto px-4 pb-4 text-[11px] leading-[1.45] text-dimmed">Changes are auto applied.</p>
          </div>

          <div class="flex min-w-0 flex-1 flex-col">
            <header class="flex h-[52px] shrink-0 items-center gap-4 border-b border-(--pref-line) px-5">
              <h2 class="min-w-0 flex-1 text-[15px] font-semibold leading-tight text-highlighted">{{ current.label }}</h2>
              <DialogDescription class="sr-only">{{ current.label }} preferences</DialogDescription>
              <DialogClose class="pref-button">Done</DialogClose>
            </header>
            <TabsContent
              v-for="section in sections"
              :key="section.id"
              :value="section.id"
              tabindex="-1"
              class="settings-body min-h-0 flex-1 outline-none"
              :class="section.id === 'devices' ? 'flex' : 'overflow-y-auto px-5 pb-5'"
            >
              <component :is="section.component" />
            </TabsContent>
          </div>
        </TabsRoot>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
/* --ui-border equals --ui-bg-elevated in the dark theme, so hairlines on this floating layer take the accented border */
.settings-view {
  --pref-line: color-mix(in oklab, var(--ui-border-accented) 75%, transparent);
}

.settings-view :deep(:is(button, select, input, textarea, [role='tab'], [role='radio'], [role='switch']):focus-visible) {
  outline: 2px solid var(--ui-primary);
  outline-offset: 1px;
}

.settings-view :deep(.pref-input:focus-visible) {
  outline-offset: -1px;
}

.settings-view :deep(.pref-segment:focus-visible) {
  outline-offset: -2px;
}
</style>
