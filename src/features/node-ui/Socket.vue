<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'

defineProps<{ id: string; side: 'in' | 'out'; color: string; shape?: 'circle' | 'diamond' }>()
</script>

<template>
  <Handle
    :id="id"
    :type="side === 'in' ? 'target' : 'source'"
    :position="side === 'in' ? Position.Left : Position.Right"
    class="nui-socket"
    :class="{ 'is-diamond': shape === 'diamond' }"
    :style="{ background: color }"
  />
</template>
