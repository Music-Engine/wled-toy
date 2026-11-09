<script setup lang="ts">
import { onActivated, onBeforeUnmount, onDeactivated, onMounted } from 'vue'
import { registerHandlers } from '@/lib/app/commands'

const props = defineProps<{ handlers: Record<string, () => unknown> }>()

let release: (() => void) | undefined

// an inline object in a template is a new one on every render, so the bound functions look the handler up when they run
function bind() {
  release ??= registerHandlers(Object.fromEntries(Object.keys(props.handlers).map((id) => [id, () => props.handlers[id]?.()])))
}

function unbind() {
  release?.()
  release = undefined
}

onMounted(bind)
onActivated(bind)
onDeactivated(unbind)
onBeforeUnmount(unbind)
</script>

<template>
  <slot />
</template>
