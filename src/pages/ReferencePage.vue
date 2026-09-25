<script setup lang="ts">
import { computed, nextTick, onActivated, ref, watch } from 'vue'
import CommandScope from '@/features/commands/CommandScope.vue'
import MatchText from '@/components/reference/MatchText.vue'
import ReferenceEntry from '@/components/reference/ReferenceEntry.vue'
import { copyText } from '@/lib/app/clipboard'
import { CATEGORIES, NODES, nodeByName, type CategoryId, type ShaderNode } from '@/lib/shader/glsl'

const query = ref('')
const categoryIndex = ref(0)
const copied = ref<string | null>(null)
const search = ref<HTMLInputElement>()
const categoryButtons = ref<HTMLElement[]>([])
const entryList = ref<HTMLElement>()
const indexList = ref<HTMLElement>()
const activeEntry = ref<string | null>(null)

const categoryRows = computed(() => [
  { id: null as CategoryId | null, label: 'All', color: null as string | null },
  ...CATEGORIES.filter((category) => NODES.some((node) => node.category === category.id)).map((category) => ({ id: category.id, label: category.label, color: category.color })),
])

const matchedNodes = computed(() => {
  const q = query.value.trim().toLowerCase()
  return NODES.filter((node) => !q || `${node.name} ${node.title} ${node.doc}`.toLowerCase().includes(q))
})

const categories = computed(() => categoryRows.value.map((row) => ({
  ...row,
  count: row.id === null ? matchedNodes.value.length : matchedNodes.value.filter((node) => node.category === row.id).length,
})))

const selectedCategory = computed(() => categoryRows.value[categoryIndex.value]?.id ?? null)
const sections = computed(() => categories.value
  .filter((row) => row.id !== null && row.count > 0 && (selectedCategory.value === null || row.id === selectedCategory.value))
  .map((row) => ({ ...row, nodes: matchedNodes.value.filter((node) => node.category === row.id) })))

const entryElements = () => [...(entryList.value?.querySelectorAll<HTMLElement>('[data-entry]') ?? [])]

function trackActiveEntry() {
  const list = entryList.value
  if (!list) return
  const top = list.getBoundingClientRect().top + 36
  activeEntry.value = entryElements().find((el) => el.getBoundingClientRect().bottom > top)?.dataset.entry ?? null
}

watch([query, categoryIndex], async () => {
  await nextTick()
  entryList.value?.scrollTo({ top: 0 })
  trackActiveEntry()
})

watch(activeEntry, (name) => indexList.value?.querySelector(`[data-index-entry="${name}"]`)?.scrollIntoView({ block: 'nearest' }), { flush: 'post' })

function jumpTo(name: string) {
  const el = entryElements().find((entry) => entry.dataset.entry === name)
  el?.scrollIntoView({ block: 'start' })
  el?.focus({ preventScroll: true })
}

function onEntryKeydown(e: KeyboardEvent, node: ShaderNode) {
  if (e.target !== e.currentTarget) return
  if (e.key === 'Enter') return void copy(node)
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  const rows = entryElements()
  rows[rows.indexOf(e.currentTarget as HTMLElement) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus()
}

function onCategoryKeydown(e: KeyboardEvent) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  const delta = e.key === 'ArrowDown' ? 1 : -1
  categoryIndex.value = Math.min(categoryRows.value.length - 1, Math.max(0, categoryIndex.value + delta))
}

// the row elements are stable refs, not derived from the current render pass, so no tick needs to pass before focusing one
watch(categoryIndex, (index) => categoryButtons.value[index]?.focus())

async function copy(node: ShaderNode) {
  await copyText(node.kind === 'function' ? node.signature : node.snippet.replace(/\$\{([^}]*)\}/g, '$1'))
  copied.value = node.name
  setTimeout(() => copied.value === node.name && (copied.value = null), 1200)
}

function copyFocused() {
  const name = (document.activeElement as HTMLElement | null)?.dataset.entry
  const node = name ? nodeByName.get(name) : undefined
  if (node) void copy(node)
}

function focusSearch() {
  search.value?.focus()
  search.value?.select()
}

onActivated(trackActiveEntry)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex h-(--app-header-h) shrink-0 items-center gap-2 border-b border-(--app-hairline) bg-(--app-chrome) px-2">
      <input
        ref="search"
        v-model="query"
        type="text"
        class="app-field w-[240px]"
        placeholder="Search names and descriptions"
        aria-label="Search reference"
        spellcheck="false"
        @keydown.escape="query = ''"
      >
      <span class="ms-auto shrink-0 text-[12px] tabular-nums text-muted">
        {{ query.trim() ? `${matchedNodes.length} of ${NODES.length}` : matchedNodes.length }} {{ matchedNodes.length === 1 ? 'entry' : 'entries' }}
      </span>
    </div>

    <div class="flex min-h-0 flex-1">
      <div
        role="listbox"
        aria-label="Reference categories"
        class="flex w-[180px] shrink-0 flex-col overflow-y-auto border-e border-(--app-hairline) py-1"
        @keydown="onCategoryKeydown"
      >
        <button
          v-for="(row, i) in categories"
          :key="row.id ?? 'all'"
          :ref="(el) => (categoryButtons[i] = el as HTMLElement)"
          type="button"
          role="option"
          :aria-selected="i === categoryIndex"
          :tabindex="i === categoryIndex ? 0 : -1"
          class="flex h-(--app-row-h) w-full shrink-0 items-center gap-2 px-2.5 text-start text-[12px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          :class="[
            i === categoryIndex ? 'bg-accented text-highlighted' : 'text-muted hover:bg-(--app-hover) hover:text-default',
            row.count === 0 && 'opacity-50',
          ]"
          @click="categoryIndex = i"
        >
          <span class="size-2 shrink-0 rounded-sm" :style="{ background: row.color ?? 'transparent' }" />
          <span class="min-w-0 flex-1 truncate">{{ row.label }}</span>
          <span class="shrink-0 tabular-nums text-dimmed">{{ row.count }}</span>
        </button>
      </div>

      <div class="@container flex min-w-0 flex-1">
        <div ref="entryList" class="min-w-0 flex-1 overflow-y-auto" @scroll.passive="trackActiveEntry">
          <section v-for="section in sections" :key="section.id!" :aria-label="section.label">
            <h2 class="sticky top-0 z-10 flex h-8 items-center gap-2 border-b border-(--app-hairline) bg-(--app-surface) px-6 text-[13px] font-semibold text-highlighted">
              <span class="size-2 shrink-0 rounded-sm" :style="{ background: section.color! }" />
              {{ section.label }}
              <span class="font-normal tabular-nums text-dimmed">{{ section.count }}</span>
            </h2>
            <ReferenceEntry
              v-for="node in section.nodes"
              :key="node.name"
              :node="node"
              :query="query"
              :copied="copied === node.name"
              @copy="copy(node)"
              @keydown="onEntryKeydown($event, node)"
            />
          </section>

          <div v-if="!sections.length" data-empty class="px-6 py-10">
            <p class="text-[15px] font-semibold text-highlighted">No entries match "{{ query.trim() }}"</p>
            <p class="mt-2 max-w-[56ch] text-[13px] leading-[1.65] text-muted">
              Search looks at function names, titles and descriptions.
              <template v-if="matchedNodes.length">{{ categories[categoryIndex].label }} has no match, but other categories do.</template>
              <template v-else>Try a shorter word, like "wave" or "audio".</template>
            </p>
            <div class="mt-4 flex gap-2">
              <button v-if="matchedNodes.length" type="button" class="app-button" @click="categoryIndex = 0">
                Show {{ matchedNodes.length }} in all categories
              </button>
              <button type="button" class="app-button" @click="query = ''; focusSearch()">Clear search</button>
            </div>
          </div>
        </div>

        <nav
          v-if="sections.length"
          ref="indexList"
          aria-label="On this page"
          class="hidden w-[152px] shrink-0 overflow-y-auto border-s border-(--app-hairline) py-2 @min-[620px]:block"
        >
          <template v-for="section in sections" :key="section.id!">
            <p v-if="sections.length > 1" class="px-3 pb-0.5 pt-2 text-[11px] text-dimmed">{{ section.label }}</p>
            <button
              v-for="node in section.nodes"
              :key="node.name"
              type="button"
              tabindex="-1"
              :data-index-entry="node.name"
              class="block h-(--app-row-dense-h) w-full truncate border-s-2 px-2.5 text-start font-mono text-[11px]"
              :class="node.name === activeEntry ? 'border-primary text-highlighted' : 'border-transparent text-muted hover:text-default'"
              @click="jumpTo(node.name)"
            >
              <MatchText :text="node.name" :query="query" />
            </button>
          </template>
        </nav>
      </div>
    </div>
  </div>

  <CommandScope :handlers="{ 'reference.focusSearch': focusSearch, 'reference.copyEntry': copyFocused }" />
</template>
