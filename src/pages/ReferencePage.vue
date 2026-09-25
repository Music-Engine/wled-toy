<script setup lang="ts">
import CommandScope from '@/features/commands/CommandScope.vue'
import ReferenceCategories from '@/features/reference/ReferenceCategories.vue'
import ReferenceEntry from '@/features/reference/ReferenceEntry.vue'
import ReferenceIndex from '@/features/reference/ReferenceIndex.vue'
import { useReferenceSearch } from '@/features/reference/use-reference-search'
import { NODES } from '@/lib/shader/catalog'

const { query, categoryIndex, copied, search, entryList, activeEntry, matchedNodes, categories, sections, trackActiveEntry, jumpTo, onEntryKeydown, copy, copyFocused, focusSearch } = useReferenceSearch()
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
      <ReferenceCategories v-model="categoryIndex" :categories="categories" />

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

        <ReferenceIndex v-if="sections.length" :sections="sections" :query="query" :active-entry="activeEntry" @jump="jumpTo" />
      </div>
    </div>
  </div>

  <CommandScope :handlers="{ 'reference.focusSearch': focusSearch, 'reference.copyEntry': copyFocused }" />
</template>
