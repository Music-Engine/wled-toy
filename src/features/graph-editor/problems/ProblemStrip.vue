<script setup lang="ts">
import { showTab, type Problem } from '@/lib/app/workspace'

defineProps<{ problems: Problem[] }>()
const emit = defineEmits<{ reveal: [nodeId: string]; goto: [line: number] }>()
</script>

<template>
  <div
    v-if="problems.length"
    class="problem-strip flex h-(--app-strip-h) shrink-0 items-center gap-2 border-t border-error/40 bg-error/10 px-2.5 text-[12px]"
    role="alert"
  >
    <button type="button" class="min-w-0 truncate text-start text-error hover:underline" :title="problems[0].message" @click="showTab('problems')">
      {{ problems[0].message }}
    </button>
    <span v-if="problems[0].location" class="shrink-0 text-muted">{{ problems[0].location }}</span>
    <button v-if="problems.length > 1" type="button" class="shrink-0 text-muted hover:text-default" @click="showTab('problems')">+{{ problems.length - 1 }} more</button>
    <button
      v-if="problems[0].nodeId"
      type="button"
      class="ms-auto h-[18px] shrink-0 rounded-[4px] border border-accented px-1.5 text-default hover:bg-(--app-hover)"
      @click="emit('reveal', problems[0].nodeId)"
    >
      Show node
    </button>
    <button
      v-else-if="problems[0].line"
      type="button"
      class="ms-auto h-[18px] shrink-0 rounded-[4px] border border-accented px-1.5 text-default hover:bg-(--app-hover)"
      @click="emit('goto', problems[0].line)"
    >
      Go to line
    </button>
  </div>
</template>
