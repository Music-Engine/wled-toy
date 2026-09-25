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
