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
