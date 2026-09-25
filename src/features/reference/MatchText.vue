<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ text: string, query: string }>()

const parts = computed(() => {
  const q = props.query.trim().toLowerCase()
  if (!q) return [{ text: props.text, hit: false }]
  const pattern = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  return props.text.split(pattern).filter(Boolean).map((text) => ({ text, hit: text.toLowerCase() === q }))
})
</script>

<template>
  <span>
    <template v-for="(part, i) in parts" :key="i">
      <mark v-if="part.hit" class="rounded-[2px] bg-primary/30 text-inherit">{{ part.text }}</mark>
      <template v-else>{{ part.text }}</template>
    </template>
  </span>
</template>
