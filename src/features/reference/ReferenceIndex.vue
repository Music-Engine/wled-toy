<script setup lang="ts">
import { ref, watch } from 'vue'
import MatchText from './MatchText.vue'
import type { ShaderNode } from '@/lib/shader/catalog'

const props = defineProps<{ sections: Array<{ id: string | null; label: string; nodes: ShaderNode[] }>; query: string; activeEntry: string | null }>()
defineEmits<{ jump: [name: string] }>()

const nav = ref<HTMLElement>()

watch(() => props.activeEntry, (name) => nav.value?.querySelector(`[data-index-entry="${name}"]`)?.scrollIntoView({ block: 'nearest' }), { flush: 'post' })
</script>

<template>
  <nav ref="nav" aria-label="On this page" class="hidden w-[152px] shrink-0 overflow-y-auto border-s border-(--app-hairline) py-2 @min-[620px]:block">
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
        @click="$emit('jump', node.name)"
      >
        <MatchText :text="node.name" :query="query" />
      </button>
    </template>
  </nav>
</template>
