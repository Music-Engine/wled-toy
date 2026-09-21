<script setup lang="ts">
import { computed } from 'vue'
import TransportGroup from './TransportGroup.vue'
import OutputButton from './OutputButton.vue'
import { runCommand } from '@/lib/app/commands'
import { useEngine } from '@/lib/engine/engine'
import { config } from '@/lib/app/config'
import { logs } from '@/lib/app/logs'
import { workspace } from '@/lib/app/workspace'

const { stats } = useEngine().bridge

const bridge = computed(() => ({
  connected: { dot: 'bg-success', label: 'Bridge online' },
  connecting: { dot: 'bg-warning', label: 'Bridge connecting' },
  disconnected: { dot: 'bg-error', label: 'Bridge offline' },
}[stats.status]))

const lastLog = computed(() => logs.value[logs.value.length - 1])
</script>

<template>
  <footer class="flex h-(--app-status-h) shrink-0 items-center gap-3 border-t border-(--app-hairline) bg-(--app-chrome) px-2 text-[11px] text-muted">
    <TransportGroup @choose-song="runCommand('audio.fromFile')" />
    <OutputButton />
    <span class="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
      <span class="size-1.5 rounded-full" :class="bridge.dot" />
      {{ bridge.label }}
    </span>
    <span class="shrink-0 whitespace-nowrap tabular-nums">{{ config.ledCount }} LEDs</span>
    <button v-if="workspace.problemCount" type="button" class="status-problems shrink-0 whitespace-nowrap tabular-nums text-error hover:underline" @click="runCommand('view.panel.problems')">
      {{ workspace.problemCount }} {{ workspace.problemCount === 1 ? 'problem' : 'problems' }}
    </button>
    <button
      v-if="lastLog"
      type="button"
      class="status-log ms-auto min-w-0 truncate hover:text-default"
      :class="{ 'text-error': lastLog.level === 'error', 'text-warning': lastLog.level === 'warn' }"
      :title="lastLog.message"
      @click="runCommand('view.panel.log')"
    >
      {{ lastLog.message }}
    </button>
  </footer>
</template>
