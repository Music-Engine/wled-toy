<script setup lang="ts">
defineProps<{ modelValue: boolean; label?: string }>()
defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <div
    class="nui-checkbox nodrag"
    :class="{ 'is-checked': modelValue }"
    role="checkbox"
    tabindex="0"
    :aria-checked="modelValue"
    @click="$emit('update:modelValue', !modelValue)"
    @keydown.space.prevent="$emit('update:modelValue', !modelValue)"
  >
    <span class="nui-checkbox-box">
      <svg v-if="modelValue" viewBox="0 0 12 12"><path d="M2 6.5l3 3 5-6" /></svg>
    </span>
    <span class="nui-label">{{ label }}</span>
  </div>
</template>
