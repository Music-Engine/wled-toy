<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useEngine } from '@/lib/engine/engine'
import { Format } from '@/lib/util/format'

const emit = defineEmits<{ chooseSong: [] }>()

const engine = useEngine()
const audio = engine.audio.state

const clock = ref('00:00.0')
const clockTimer = setInterval(() => {
  clock.value = Format.clock(engine.elapsed())
}, 100)
onUnmounted(() => clearInterval(clockTimer))

const track = computed(() => ({ file: audio.fileName, device: 'Microphone', loopback: 'System audio' }[audio.settings.source]))

const trackItems = [
  { label: 'Choose song...', onSelect: () => emit('chooseSong') },
  { label: 'Use built-in track', onSelect: () => void engine.useSong(null) },
]
</script>

<template>
  <div class="transport flex h-[26px] shrink-0 items-stretch divide-x divide-accented overflow-hidden rounded-[4px] border border-accented text-[12px]">
    <UTooltip text="Reset time">
      <button type="button" class="flex w-7 items-center justify-center text-muted hover:bg-(--app-hover) hover:text-default" aria-label="Reset time" @click="engine.resetTime()">
        <UIcon name="i-lucide-skip-back" class="size-4" />
      </button>
    </UTooltip>
    <UTooltip :text="audio.playing ? 'Pause audio' : 'Play audio'">
      <button
        type="button"
        class="flex w-7 items-center justify-center"
        :class="audio.playing ? 'bg-primary text-inverted' : 'text-muted hover:bg-(--app-hover) hover:text-default'"
        :aria-label="audio.playing ? 'Pause audio' : 'Play audio'"
        :aria-pressed="audio.playing"
        @click="engine.toggleAudio()"
      >
        <UIcon :name="audio.playing ? 'i-lucide-pause' : 'i-lucide-play'" class="size-4" />
      </button>
    </UTooltip>
    <span class="transport-clock flex w-[68px] items-center justify-center font-mono tabular-nums text-default">{{ clock }}</span>
    <UDropdownMenu :items="trackItems" size="sm">
      <button type="button" class="flex min-w-0 items-center gap-1 px-2 text-muted hover:bg-(--app-hover) hover:text-default">
        <span class="max-w-[132px] truncate">{{ track }}</span>
        <UIcon name="i-lucide-chevron-down" class="size-3 shrink-0" />
      </button>
    </UDropdownMenu>
  </div>
</template>
