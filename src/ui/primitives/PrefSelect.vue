<script setup lang="ts" generic="T extends string">
defineProps<{ id?: string; options: Array<{ value: T; label: string }> }>()
const model = defineModel<T>({ required: true })
</script>

<template>
  <span class="pref-select">
    <select :id="id" v-model="model" class="pref-input w-full">
      <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>
  </span>
</template>

<style scoped>
.pref-select {
  position: relative;
  display: block;
  width: 100%;
}

.pref-select select {
  appearance: none;
  padding-inline-end: 24px;
}

.pref-select::after {
  content: '';
  position: absolute;
  inset-inline-end: 9px;
  top: 8px;
  width: 6px;
  height: 6px;
  border: solid var(--ui-text-muted);
  border-width: 0 1.5px 1.5px 0;
  transform: rotate(45deg);
  pointer-events: none;
}
</style>
