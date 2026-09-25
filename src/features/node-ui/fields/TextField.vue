<script setup lang="ts">
defineProps<{ modelValue: string; label?: string; placeholder?: string }>()
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <label class="nui-field nui-text nodrag">
    <span v-if="label" class="nui-label">{{ label }}</span>
    <!-- committed on change, not per keystroke: every edit of a node value regenerates the graph -->
    <input class="nui-input" :value="modelValue" :placeholder="placeholder" spellcheck="false" @change="$emit('update:modelValue', ($event.target as HTMLInputElement).value)" @keydown.enter="($event.target as HTMLInputElement).blur()">
  </label>
</template>
