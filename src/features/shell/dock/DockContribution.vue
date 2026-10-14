<script setup lang="ts">
import { onActivated, onDeactivated, ref } from 'vue'
import { dockHost, type TabId } from '@/lib/app/workspace'

const props = defineProps<{ tab: TabId }>()

// KeepAlive leaves an enabled Teleport's children in the target when it deactivates the owner, so a kept-alive page has to pull its contribution back itself
const active = ref(true)
onActivated(() => (active.value = true))
onDeactivated(() => (active.value = false))
</script>

<template>
  <Teleport :to="dockHost(props.tab)" :disabled="!active">
    <slot />
  </Teleport>
</template>
