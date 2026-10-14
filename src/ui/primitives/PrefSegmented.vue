<script setup lang="ts" generic="T extends string">
import { RadioGroupItem, RadioGroupRoot } from 'reka-ui'

defineProps<{ options: Array<{ value: T; label: string }>; labelledBy?: string }>()
const model = defineModel<T>({ required: true })
</script>

<template>
  <RadioGroupRoot v-model="model" orientation="horizontal" class="pref-segmented" :aria-labelledby="labelledBy">
    <RadioGroupItem v-for="option in options" :key="option.value" :value="option.value" class="pref-segment">
      {{ option.label }}
    </RadioGroupItem>
  </RadioGroupRoot>
</template>

<style scoped>
.pref-segmented {
  display: flex;
  width: 100%;
  height: 24px;
  overflow: hidden;
  border: 1px solid var(--ui-border-accented);
  border-radius: 4px;
  background: var(--ui-bg);
}

.pref-segment {
  flex: 1;
  cursor: default;
  font-size: 12px;
  color: var(--ui-text-muted);
  transition: background-color 80ms;
}

.pref-segment + .pref-segment {
  border-inline-start: 1px solid var(--ui-border-accented);
}

.pref-segment:hover {
  background: var(--app-hover);
}

.pref-segment[data-state='checked'] {
  background: var(--ui-bg-accented);
  font-weight: 500;
  color: var(--ui-text-highlighted);
}
</style>
