<script setup lang="ts">
const props = defineProps<{ id?: string; placeholder?: string; validate?: (text: string) => string | null }>()
const model = defineModel<string>({ required: true })
const emit = defineEmits<{ error: [message: string | null] }>()

// commits on blur or Enter: a device's host re-sends the bridge config on every change, so it must not change per keystroke
function commit(e: Event) {
  const text = (e.target as HTMLInputElement).value.trim()
  const message = props.validate?.(text) ?? null
  emit('error', message)
  if (!message) model.value = text
}
</script>

<template>
  <input :id="id" type="text" class="pref-input w-full" :value="model" :placeholder="placeholder" spellcheck="false" autocomplete="off" @change="commit" @keydown.enter="commit">
</template>
