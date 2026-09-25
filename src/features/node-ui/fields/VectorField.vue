<script setup lang="ts">
import RangeField from './RangeField.vue'
import { useInvalidParts } from './use-node-field'

const props = defineProps<{ modelValue: number[]; step?: number; min?: number; max?: number; decimals?: number }>()
const emit = defineEmits<{
  'update:modelValue': [value: number[]]
  invalid: [invalid: boolean]
}>()

const { mark: markInvalid } = useInvalidParts((invalid) => emit('invalid', invalid))

function setComponent(index: number, value: number) {
  const next = [...props.modelValue]
  next[index] = value
  emit('update:modelValue', next)
}
</script>

<template>
  <div class="nui-vector">
    <RangeField
      v-for="(component, i) in modelValue"
      :key="i"
      :model-value="component"
      :label="'XYZW'[i]"
      :step="step"
      :min="min"
      :max="max"
      :decimals="decimals"
      @update:model-value="setComponent(i, $event)"
      @invalid="markInvalid(i, $event)"
    />
  </div>
</template>
