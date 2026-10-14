<script setup lang="ts">
defineProps<{ label: string }>()
</script>

<template>
  <div class="inspector-row flex min-h-(--app-row-h) items-center gap-2 px-2.5">
    <span class="w-24 shrink-0 truncate text-muted">{{ label }}</span>
    <div class="flex min-w-0 flex-1 items-center gap-1.5">
      <slot />
    </div>
  </div>
</template>
