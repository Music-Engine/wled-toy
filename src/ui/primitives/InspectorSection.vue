<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <section class="inspector-section border-b border-(--app-hairline) pb-1.5 text-[12px]">
    <h3 class="flex h-(--app-row-h) items-center px-2.5 text-[11px] font-medium text-dimmed">{{ title }}</h3>
    <slot />
  </section>
</template>
