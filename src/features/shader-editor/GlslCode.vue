<script setup lang="ts">
import { computed } from 'vue'
import { highlightGlslHtml } from '@/lib/shader/glsl-highlight'
import './shader-editor.css'

const props = defineProps<{ code: string }>()
const html = computed(() => highlightGlslHtml(props.code))
</script>

<template>
  <!-- highlightGlslHtml escapes the source text before wrapping tokens in spans -->
  <code class="whitespace-pre-wrap break-words font-mono" v-html="html" />
</template>
