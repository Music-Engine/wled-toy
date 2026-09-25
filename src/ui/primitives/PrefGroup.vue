<script setup lang="ts">
defineProps<{ title?: string }>()
</script>

<template>
  <section class="pref-group">
    <h3 v-if="title" class="pref-group-title">{{ title }}</h3>
    <div class="pref-rows">
      <slot />
    </div>
  </section>
</template>
