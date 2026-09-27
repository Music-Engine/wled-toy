<script setup lang="ts">
import { ref } from 'vue'
import { useNodeField } from './use-node-field'
import '@/features/node-ui/node.css'
import './fields.css'

const props = withDefaults(defineProps<{
  modelValue: number
  label?: string
  min?: number
  max?: number
  /** Shows steppers and sets their increment. */
  step?: number
  decimals?: number
}>(), { label: '', min: -Infinity, max: Infinity, step: undefined, decimals: 3 })
const emit = defineEmits<{
  'update:modelValue': [value: number]
  invalid: [invalid: boolean]
}>()

const input = ref<HTMLInputElement>()
const { editing, pressed, invalid, text, display, fill, set, commit, onPointerDown, onPointerMove, onPointerUp } = useNodeField(
  props,
  (value) => emit('update:modelValue', value),
  (next) => emit('invalid', next),
  input,
)
</script>

<template>
  <div
    class="nui-field nodrag"
    :class="{ 'is-pressed': pressed, 'is-invalid': invalid }"
    role="spinbutton"
    :aria-label="label"
    :aria-valuenow="modelValue"
    :title="invalid ? 'Not a number. The last valid value is still used.' : undefined"
  >
    <input
      v-if="editing"
      ref="input"
      v-model="text"
      class="nui-input"
      spellcheck="false"
      @keydown.enter.prevent="commit"
      @keydown.esc.prevent="editing = false"
      @blur="commit"
    >
    <template v-else>
      <div class="nui-range-fill" :style="{ width: fill }" />
      <button v-if="step" type="button" class="nui-range-step is-down" tabindex="-1" aria-label="Decrease" @click="set(modelValue - step)">
        <svg viewBox="0 0 10 10"><path d="M2 0l6 5-6 5z" /></svg>
      </button>
      <div class="nui-range-text" @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp">
        <span class="nui-label">{{ label }}</span>
        <span class="nui-range-value">{{ display }}</span>
      </div>
      <button v-if="step" type="button" class="nui-range-step" tabindex="-1" aria-label="Increase" @click="set(modelValue + step)">
        <svg viewBox="0 0 10 10"><path d="M2 0l6 5-6 5z" /></svg>
      </button>
    </template>
  </div>
</template>
