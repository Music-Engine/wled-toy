<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watchEffect } from 'vue'
import CommandScope from '@/components/shell/CommandScope.vue'
import { contextMenuItems } from '@/lib/app/commands'
import { contextProblem, workspace, type Problem } from '@/lib/app/workspace'

const props = defineProps<{ problems: Problem[] }>()
const emit = defineEmits<{ reveal: [nodeId: string]; goto: [line: number] }>()

function open(problem: Problem) {
  if (problem.nodeId) emit('reveal', problem.nodeId)
  else if (problem.line) emit('goto', problem.line)
}

function openContext() {
  if (contextProblem.value) open(contextProblem.value)
}

const menu = computed(() => contextMenuItems([['problems.copyMessage', 'problems.goto']]))

// Both editing pages stay mounted; only the one on screen owns the shared count. Publishing waits for the mounted hook
// because setup runs before the page being left gets its deactivated hook, which would zero the count afterwards.
const active = ref(false)
onMounted(() => (active.value = true))
onActivated(() => (active.value = true))
onDeactivated(() => {
  active.value = false
  workspace.problemCount = 0
})
onBeforeUnmount(() => {
  if (active.value) workspace.problemCount = 0
})

watchEffect(() => {
  if (active.value) workspace.problemCount = props.problems.length
})
</script>

<template>
  <UContextMenu :items="menu">
    <ol class="problems-list text-[12px]">
      <li
        v-for="(problem, i) in problems"
        :key="i"
        class="flex h-(--app-row-dense-h) items-center gap-2 px-2.5 hover:bg-(--app-hover)"
        @click="open(problem)"
        @contextmenu="contextProblem = problem"
      >
        <span class="size-1.5 shrink-0 rounded-full bg-error" />
        <span class="min-w-0 truncate text-default" :title="problem.message">{{ problem.message }}</span>
        <span v-if="problem.location" class="ms-auto shrink-0 text-muted">{{ problem.location }}</span>
      </li>
      <li v-if="!problems.length" class="px-2.5 py-2 text-dimmed">No problems</li>
    </ol>
  </UContextMenu>
  <CommandScope :handlers="{ 'problems.goto': openContext }" />
</template>
