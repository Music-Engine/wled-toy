<script setup lang="ts" generic="T">
import { nextTick, ref, watch } from 'vue'
import GlslCode from '@/features/shader-editor/GlslCode.vue'
import type { MenuEntry, MenuFs, MenuPreset } from '@/lib/shader/menu-fs'
import { useNodeMenu } from './use-node-menu'
import './node-menu.css'

const props = defineProps<{
  position: { x: number; y: number } | null
  fs: MenuFs<T>
  describe: (node: T, preset?: MenuPreset) => MenuEntry
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ select: [node: T, preset?: MenuPreset] }>()

const search = ref<HTMLInputElement>()
const list = ref<HTMLElement>()
const { query, activeDirectory, highlighted, hovered, directory, rows, nodeRows, preview, showPreview, style, step, moveDirectory } =
  useNodeMenu(props, open, () => search.value?.focus())

watch(highlighted, async () => {
  await nextTick()
  list.value?.querySelector('[data-highlighted="true"]')?.scrollIntoView({ block: 'nearest' })
})

function choose(node: T, preset?: MenuPreset) {
  emit('select', node, preset)
  open.value = false
}

function onKeydown(e: KeyboardEvent) {
  const handlers: Record<string, () => void> = {
    Escape: () => (open.value = false),
    ArrowDown: () => step(1),
    ArrowUp: () => step(-1),
    Enter: () => {
      const row = nodeRows.value[highlighted.value]
      if (row) choose(row.node, row.preset)
    },
    Tab: () => moveDirectory(e.shiftKey ? -1 : 1),
  }
  const handler = handlers[e.key]
  if (!handler) return
  e.preventDefault()
  handler()
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50" @mousedown.self="open = false">
      <div
        class="node-menu absolute flex overflow-hidden rounded-lg border border-default bg-default/95 text-sm shadow-2xl ring-1 ring-black/40 backdrop-blur"
        :style="style"
        role="dialog"
        aria-label="Add shader node"
        @keydown="onKeydown"
      >
        <div class="flex w-44 shrink-0 flex-col border-e border-default bg-elevated/40">
          <div class="flex items-center gap-2 px-3 pb-2 pt-3 text-xs font-semibold uppercase tracking-wider text-muted">
            <UIcon name="i-lucide-plus" class="size-3.5" />
            {{ fs.title }}
          </div>
          <button
            v-for="dir in fs.items"
            :key="dir.title"
            type="button"
            class="group flex items-center gap-2 px-3 py-1.5 text-start transition-colors"
            :class="!query && directory?.title === dir.title ? 'bg-accented text-highlighted' : 'text-toned hover:bg-elevated'"
            @mouseenter="!query && (activeDirectory = dir.title)"
            @click="query = ''; activeDirectory = dir.title"
          >
            <span class="size-2.5 rounded-sm" :style="{ background: dir.color }" />
            <UIcon v-if="dir.icon" :name="dir.icon" class="size-4 text-muted group-hover:text-default" />
            <span class="flex-1 truncate">{{ dir.title }}</span>
            <UIcon name="i-lucide-chevron-right" class="size-3.5 text-dimmed" />
          </button>
          <div class="mt-auto space-y-1 border-t border-default p-3 text-xs text-dimmed">
            <div class="flex items-center gap-1"><UKbd value="tab" size="sm" /> directory</div>
            <div class="flex items-center gap-1"><UKbd value="enter" size="sm" /> insert</div>
          </div>
        </div>

        <div class="flex flex-col" :class="showPreview ? 'w-64 shrink-0 border-e border-default' : 'min-w-0 flex-1'">
          <div class="border-b border-default p-2">
            <label class="flex items-center gap-2 rounded-md bg-elevated px-2 py-1.5 ring-1 ring-default focus-within:ring-primary">
              <UIcon name="i-lucide-search" class="size-4 text-dimmed" />
              <input
                ref="search"
                v-model="query"
                class="w-full bg-transparent text-sm outline-none placeholder:text-dimmed"
                placeholder="Search nodes..."
                spellcheck="false"
              >
            </label>
          </div>
          <ul ref="list" class="flex-1 overflow-y-auto p-1">
            <li v-for="(row, i) in rows" :key="row.kind === 'node' ? row.entry.id : `${row.kind}-${i}`">
              <hr v-if="row.kind === 'separator'" class="mx-2 my-1 border-default">
              <div
                v-else-if="row.kind === 'directory'"
                class="flex items-center gap-1.5 px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-muted"
                :style="{ paddingInlineStart: `${0.5 + row.depth * 0.75}rem` }"
                :title="row.description"
              >
                <UIcon name="i-lucide-folder" class="size-3.5" />
                {{ row.title }}
              </div>
              <button
                v-else
                type="button"
                class="flex w-full items-center gap-2 rounded py-1.5 pe-2 text-start"
                :class="row.index === highlighted ? 'bg-primary/20 text-highlighted' : 'text-toned hover:bg-elevated'"
                :style="{ paddingInlineStart: `${0.5 + row.depth * 0.75}rem` }"
                :data-highlighted="row.index === highlighted"
                @mouseenter="hovered = row.entry; highlighted = row.index"
                @mouseleave="hovered = null"
                @click="choose(row.node, row.preset)"
              >
                <!-- the title keeps its width; the long directory path is what gives way -->
                <span class="max-w-[70%] shrink-0 truncate">{{ row.entry.title }}<span v-if="row.entry.of" class="text-dimmed"> ({{ row.entry.of }})</span></span>
                <span class="min-w-0 flex-1 truncate text-end text-xs text-dimmed">{{ query ? row.path.join(' / ') : '' }}</span>
              </button>
            </li>
            <li v-if="nodeRows.length === 0" class="px-2 py-6 text-center text-dimmed">{{ query ? `No nodes match "${query}"` : 'Nothing here' }}</li>
          </ul>
        </div>

        <div v-if="showPreview" class="dot-grid flex min-w-0 flex-1 flex-col items-center justify-center-safe gap-4 overflow-y-auto px-6 py-5">
          <template v-if="preview">
            <div class="w-full max-w-60 shrink-0 rounded-md border border-black/60 bg-[#303030] text-[13px] text-neutral-200 shadow-lg">
              <div class="flex items-center gap-1.5 rounded-t-[5px] px-2 py-1 font-medium text-white" :style="{ background: preview.color }">
                <UIcon name="i-lucide-chevron-down" class="size-3.5 opacity-70" />
                <UIcon :name="preview.icon" class="size-3.5" />
                <span class="truncate">{{ preview.title }}</span>
              </div>
              <div class="space-y-1 py-2">
                <div v-for="output in preview.outputs" :key="output.label" class="relative flex items-center justify-end pe-3">
                  <span>{{ output.label }}</span>
                  <span class="absolute -end-1.5 size-3 rounded-full border border-black/70" :style="{ background: output.color }" />
                </div>
                <div v-for="input in preview.inputs" :key="input.label" class="relative flex items-center ps-3">
                  <span v-if="input.color" class="absolute -start-1.5 size-3 rounded-full border border-black/70" :style="{ background: input.color }" />
                  <span class="flex-1">{{ input.label }}</span>
                  <span class="pe-2 text-[11px] text-neutral-400">{{ input.type }}</span>
                </div>
                <div v-if="preview.note" class="px-3 text-[11px] uppercase tracking-wide text-neutral-400">{{ preview.note }}</div>
              </div>
            </div>
            <div class="w-full max-w-72 space-y-2 text-center">
              <p class="text-toned">{{ preview.description }}</p>
              <GlslCode v-if="preview.signature" :code="preview.signature" class="block rounded bg-elevated px-2 py-1 text-start text-xs text-highlighted" />
            </div>
          </template>
          <p v-else class="text-dimmed">Hover a node to preview it</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>
