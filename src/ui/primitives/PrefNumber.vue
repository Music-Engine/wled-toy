<script setup lang="ts">
defineOptions({ inheritAttrs: false })

const props = defineProps<{ id?: string; min: number; max: number; step?: number; unit?: string; disabled?: boolean }>()
const model = defineModel<number>({ required: true })
const emit = defineEmits<{ error: [message: string | null] }>()

// commits on blur, Enter or a spinner step, never per keystroke; what is out of range stays in the field with a message instead of being clamped silently
function commit(e: Event) {
  const text = (e.target as HTMLInputElement).value.trim()
  const value = Number(text)
  const whole = (props.step ?? 1) % 1 === 0
  if (!text || !Number.isFinite(value) || value < props.min || value > props.max || (whole && !Number.isInteger(value))) {
    emit('error', `Enter a ${whole ? 'whole ' : ''}number from ${props.min} to ${props.max}`)
    return
  }
  emit('error', null)
  model.value = value
}
</script>

<template>
  <span class="flex items-center gap-1.5">
    <input v-bind="$attrs" :id="id" type="number" class="pref-input pref-input-number" :value="model" :min="min" :max="max" :step="step ?? 1" :disabled="disabled" @change="commit" @keydown.enter="commit">
    <span v-if="unit" class="w-[42px] text-[12px] text-muted">{{ unit }}</span>
  </span>
</template>
