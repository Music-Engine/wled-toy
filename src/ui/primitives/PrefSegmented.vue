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
