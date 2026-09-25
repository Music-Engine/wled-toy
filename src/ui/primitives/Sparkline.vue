<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ values: number[] }>()

const W = 72
const H = 14

const line = computed(() => {
  const v = props.values
  if (v.length < 2) return null
  const max = Math.max(...v)
  const min = Math.min(...v)
  const span = max - min || 1
  return v.map((y, i) => `${i ? 'L' : 'M'}${((i / (v.length - 1)) * W).toFixed(1)},${(H - 1.5 - ((y - min) / span) * (H - 3)).toFixed(1)}`).join('')
})
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" preserveAspectRatio="none" class="block" aria-hidden="true">
    <path v-if="line" :d="line" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
  </svg>
</template>
