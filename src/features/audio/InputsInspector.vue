<script setup lang="ts">
import InspectorRow from '@/ui/primitives/InspectorRow.vue'
import InspectorSection from '@/ui/primitives/InspectorSection.vue'
import { systemAudioBlocked } from '@/lib/audio/settings'
import { runCommand } from '@/lib/app/commands'
import { useEngine } from '@/lib/engine/engine'
import { isTauri } from '@/lib/app/platform'

const engine = useEngine()
const audio = engine.audio.state
const midi = engine.midi.state
</script>

<template>
  <div class="inputs-inspector">
    <InspectorSection title="Audio">
      <InspectorRow label="Source">
        <div class="flex items-center" role="group" aria-label="Audio source">
          <button
            v-for="option in [
              { value: 'file', label: 'File', blocked: null, run: () => engine.audio.configure({ source: 'file' }) },
              { value: 'device', label: 'Microphone', blocked: null, run: () => runCommand('audio.microphone') },
              { value: 'loopback', label: 'System audio', blocked: systemAudioBlocked(), run: () => runCommand('audio.system') },
            ] as const"
            :key="option.value"
            type="button"
            class="app-button border-transparent"
            :class="audio.settings.source === option.value ? 'bg-accented text-highlighted' : 'text-muted'"
            :aria-pressed="audio.settings.source === option.value"
            :data-source="option.value"
            :disabled="!!option.blocked"
            :title="option.blocked ?? undefined"
            @click="option.run()"
          >
            {{ option.label }}
          </button>
        </div>
      </InspectorRow>
      <InspectorRow label="Track">
        <span class="truncate" :class="audio.settings.source === 'file' ? 'text-default' : 'text-dimmed'" :title="audio.fileName" data-value="track">{{ audio.fileName }}</span>
        <button type="button" class="app-button ms-auto" data-action="audio.fromFile" @click="runCommand('audio.fromFile')">Choose...</button>
        <button type="button" class="app-button" data-action="audio.builtIn" @click="runCommand('audio.builtIn')">Use built-in</button>
      </InspectorRow>
      <InspectorRow v-if="audio.sampleRate" label="Sample rate">
        <span class="font-mono tabular-nums text-default">{{ audio.sampleRate }} Hz</span>
      </InspectorRow>
      <p v-if="systemAudioBlocked()" class="system-audio-note px-2.5 py-1 text-dimmed">{{ systemAudioBlocked() }}</p>
      <p v-if="audio.error" class="audio-error select-text px-2.5 py-1 text-error" role="alert">{{ audio.error }}</p>
    </InspectorSection>

    <InspectorSection title="Image">
      <InspectorRow label="Texture">
        <span class="truncate text-default" :title="engine.imageName.value" data-value="image">{{ engine.imageName.value }}</span>
        <button type="button" class="app-button ms-auto" data-action="image.fromFile" @click="runCommand('image.fromFile')">Choose...</button>
        <button type="button" class="app-button" data-action="image.builtIn" @click="runCommand('image.builtIn')">Use built-in</button>
      </InspectorRow>
    </InspectorSection>

    <InspectorSection title="MIDI">
      <p v-if="midi.error" class="select-text px-2.5 py-1 text-error" role="alert">{{ midi.error }}</p>
      <p v-else-if="!midi.available" class="midi-unavailable px-2.5 py-1 text-dimmed">{{ isTauri() ? 'MIDI is not available in the desktop app yet.' : 'This browser has no Web MIDI.' }}</p>
      <p v-else-if="!midi.enabled" class="px-2.5 py-1 text-dimmed">Off. A graph with a MIDI node turns it on.</p>
      <InspectorRow v-else label="Inputs">
        <span class="truncate" :class="midi.inputs.length ? 'text-default' : 'text-dimmed'" :title="midi.inputs.join(', ')">{{ midi.inputs.join(', ') || 'None connected' }}</span>
      </InspectorRow>
    </InspectorSection>
  </div>
</template>
