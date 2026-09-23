<script setup lang="ts">
import DocumentDialogs from '@/components/shell/DocumentDialogs.vue'
import type { GraphSession } from '@/lib/graph/model/document'

defineProps<{ document: GraphSession }>()
</script>

<template>
  <DocumentDialogs :document="document" />
</template>
