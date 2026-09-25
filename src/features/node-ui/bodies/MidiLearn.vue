<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useEngine } from '@/lib/engine/engine'
import { isTauri } from '@/lib/app/platform'
import type { SocketValue } from '@/lib/graph'

defineProps<{ nodeId: string; values: Record<string, SocketValue> }>()
const emit = defineEmits<{ update: [patch: Record<string, SocketValue>] }>()

const { midi } = useEngine()
const learning = ref(false)
let stop: (() => void) | undefined

async function learn() {
  if (learning.value) {
    stop?.()
    learning.value = false
    return
  }
  await midi.enable()
  if (!midi.state.enabled) return
  learning.value = true
  // the first control that moves is the one the user means; a released key is not a choice
  stop = midi.onMessage((message) => {
    if (message.kind === 'note' && message.value === 0) return
    emit('update', { kind: message.kind, channel: message.channel, number: message.number })
    stop?.()
    learning.value = false
  })
}

onBeforeUnmount(() => stop?.())
</script>

<template>
  <div class="nui-block nui-audio nodrag">
    <button type="button" class="nui-button nui-audio-play" :disabled="!midi.state.available" @click="learn">
      {{ learning ? 'Move a control... (click to cancel)' : 'Learn' }}
    </button>
    <p v-if="!midi.state.available" class="nui-note is-error">{{ isTauri() ? 'MIDI is not available in the desktop app yet.' : 'This browser has no Web MIDI.' }}</p>
    <p v-else-if="midi.state.error" class="nui-note is-error">{{ midi.state.error }}</p>
    <p v-else-if="midi.state.enabled" class="nui-note">{{ midi.state.inputs.join(', ') || 'No MIDI inputs connected' }}</p>
  </div>
</template>
