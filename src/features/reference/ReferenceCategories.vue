<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ReferenceCategory } from '@/lib/shader/reference-search'

const props = defineProps<{ categories: ReferenceCategory[] }>()
const index = defineModel<number>({ required: true })

const buttons = ref<HTMLElement[]>([])

function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  const delta = e.key === 'ArrowDown' ? 1 : -1
  index.value = Math.min(props.categories.length - 1, Math.max(0, index.value + delta))
}

// the row elements are stable refs, not derived from the current render pass, so no tick needs to pass before focusing one
watch(index, (i) => buttons.value[i]?.focus())
</script>

<template>
  <div
    role="listbox"
    aria-label="Reference categories"
    class="flex w-[180px] shrink-0 flex-col overflow-y-auto border-e border-(--app-hairline) py-1"
    @keydown="onKeydown"
  >
    <button
      v-for="(row, i) in categories"
      :key="row.id ?? 'all'"
      :ref="(el) => (buttons[i] = el as HTMLElement)"
      type="button"
      role="option"
      :aria-selected="i === index"
      :tabindex="i === index ? 0 : -1"
      class="flex h-(--app-row-h) w-full shrink-0 items-center gap-2 px-2.5 text-start text-[12px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      :class="[
        i === index ? 'bg-accented text-highlighted' : 'text-muted hover:bg-(--app-hover) hover:text-default',
        row.count === 0 && 'opacity-50',
      ]"
      @click="index = i"
    >
      <span class="size-2 shrink-0 rounded-sm" :style="{ background: row.color ?? 'transparent' }" />
      <span class="min-w-0 flex-1 truncate">{{ row.label }}</span>
      <span class="shrink-0 tabular-nums text-dimmed">{{ row.count }}</span>
    </button>
  </div>
</template>
