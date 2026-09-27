<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui'

defineProps<{ id?: string; labelledBy?: string }>()
const model = defineModel<boolean>({ required: true })
</script>

<template>
  <SwitchRoot :id="id" v-model="model" class="pref-switch" :aria-labelledby="labelledBy">
    <SwitchThumb class="pref-switch-thumb" />
  </SwitchRoot>
</template>

<style scoped>
.pref-switch {
  position: relative;
  width: 30px;
  height: 18px;
  flex-shrink: 0;
  cursor: default;
  border-radius: 9px;
  background: color-mix(in oklab, var(--ui-text) 28%, transparent);
  transition: background-color 80ms;
}

.pref-switch[data-state='checked'] {
  background: var(--ui-primary);
}

.pref-switch-thumb {
  display: block;
  width: 14px;
  height: 14px;
  border-radius: 7px;
  background: white;
  transform: translateX(2px);
  transition: transform 80ms;
}

.pref-switch-thumb[data-state='checked'] {
  transform: translateX(14px);
}
</style>
