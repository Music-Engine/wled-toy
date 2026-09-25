<script setup lang="ts">
import DocumentDialogs from './DocumentDialogs.vue'
import type { GraphSession } from '@/lib/graph/model/document'

defineProps<{ document: GraphSession }>()
</script>

<template>
  <DocumentDialogs :document="document" />
</template>
