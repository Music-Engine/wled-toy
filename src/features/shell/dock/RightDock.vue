<script setup lang="ts">
import DockTabs from './DockTabs.vue'
</script>

<template>
  <aside class="right-dock flex min-h-0 shrink-0 flex-col bg-(--app-surface)">
    <slot />
    <DockTabs dock="right" class="min-h-0 flex-1" />
  </aside>
</template>
