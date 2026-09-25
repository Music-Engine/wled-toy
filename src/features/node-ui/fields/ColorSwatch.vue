<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ modelValue: number[]; label?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: number[]] }>()

const hex = computed(() => `#${props.modelValue.slice(0, 3).map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`)

function onInput(e: Event) {
  const value = (e.target as HTMLInputElement).value
  emit('update:modelValue', [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255))
}
</script>

<template>
  <div class="nui-color nodrag">
    <span v-if="label" class="nui-label">{{ label }}</span>
    <span class="nui-color-swatch" :style="{ background: hex }">
      <input type="color" :value="hex" :aria-label="label || 'Color'" @input="onInput">
    </span>
  </div>
</template>
