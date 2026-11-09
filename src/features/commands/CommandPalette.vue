<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  ListboxContent,
  ListboxFilter,
  ListboxItem,
  ListboxRoot,
  VisuallyHidden,
} from 'reka-ui'
import {
  commandTitle,
  commands,
  formatAccelerator,
  getCommand,
  isEnabled,
  isVisible,
  matchesAccelerator,
  palette,
  parseAccelerator,
  runCommand,
} from '@/lib/app/commands'

const query = ref('')
const list = ref<{ highlightFirstItem: () => void }>()

const heading = computed(() => (palette.view === 'shortcuts' ? 'Keyboard Shortcuts' : 'Command Palette'))

// the shortcut list also shows what cannot run right now; the palette only offers what can
const rows = computed(() => {
  const words = query.value.toLowerCase().split(/\s+/).filter(Boolean)
  return commands.value
    .filter((command) => isVisible(command) && (palette.view === 'shortcuts' ? !!command.accelerator : isEnabled(command) && !command.contextOnly))
    .map((command) => ({ command, path: command.menu.join(' › '), title: commandTitle(command) }))
    .filter((row) => words.every((word) => `${row.path} ${row.title}`.toLowerCase().includes(word)))
})

watch(
  () => [palette.open, palette.view],
  () => {
    query.value = ''
  },
)
watch(rows, () => void nextTick(() => list.value?.highlightFirstItem()))

function select(id: string) {
  palette.open = false
  runCommand(id)
}

// the dispatcher runs nothing under a dialog, so the palette closes itself on its own keys
function onKeydown(e: KeyboardEvent) {
  const { accelerator, aliases } = getCommand('view.commandPalette')!
  if (![accelerator!, ...(aliases ?? [])].some((text) => matchesAccelerator(e, parseAccelerator(text)))) return
  e.preventDefault()
  palette.open = false
}
</script>

<template>
  <DialogRoot v-model:open="palette.open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/30" />
      <DialogContent
        class="command-palette fixed left-1/2 top-[14%] z-50 flex max-h-[60vh] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-[8px] border border-(--app-hairline) bg-(--app-floating) text-[13px] text-default shadow-2xl outline-none"
        @keydown="onKeydown"
      >
        <VisuallyHidden>
          <DialogTitle>{{ heading }}</DialogTitle>
          <DialogDescription>Type to filter, Enter to run</DialogDescription>
        </VisuallyHidden>
        <ListboxRoot ref="list" class="flex min-h-0 flex-col" highlight-on-hover>
          <ListboxFilter
            v-model="query"
            auto-focus
            class="h-10 shrink-0 border-b border-(--app-hairline) bg-transparent px-3 outline-none placeholder:text-dimmed"
            :placeholder="palette.view === 'shortcuts' ? 'Search keyboard shortcuts' : 'Type a command'"
            :aria-label="heading"
          />
          <ListboxContent class="min-h-0 overflow-y-auto p-1">
            <ListboxItem
              v-for="row in rows"
              :key="row.command.id"
              :value="row.command.id"
              :disabled="!isEnabled(row.command)"
              :data-command="row.command.id"
              class="group flex h-7 cursor-default items-center gap-2 rounded-[4px] px-2 outline-none data-[highlighted]:bg-primary data-[highlighted]:text-inverted data-[disabled]:text-dimmed"
              @select="select(row.command.id)"
            >
              <span class="shrink-0 text-muted group-data-[highlighted]:text-inverted group-data-[disabled]:text-dimmed">{{ row.path }}</span>
              <span class="truncate">{{ row.title }}</span>
              <span v-if="row.command.accelerator" class="ms-auto shrink-0 ps-4 tracking-wide text-muted group-data-[highlighted]:text-inverted group-data-[disabled]:text-dimmed">
                {{ formatAccelerator(row.command.accelerator) }}
              </span>
            </ListboxItem>
            <p v-if="!rows.length" class="px-2 py-3 text-muted">No matching commands</p>
          </ListboxContent>
        </ListboxRoot>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
