<script setup lang="ts">
import { useId } from 'vue'

defineProps<{ label: string; description?: string; error?: string | null }>()

const id = useId()
</script>

<template>
  <div class="pref-row">
    <div class="min-w-0 flex-1">
      <label :id="`${id}-label`" :for="id" class="pref-label">{{ label }}</label>
      <p v-if="description" class="pref-hint">{{ description }}</p>
      <p v-if="error" role="alert" class="pref-error">{{ error }}</p>
    </div>
    <div class="pref-control">
      <slot :id="id" :label-id="`${id}-label`" />
    </div>
  </div>
</template>
