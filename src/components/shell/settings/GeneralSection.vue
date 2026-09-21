<script setup lang="ts">
import { reactive } from 'vue'
import PrefGroup from './PrefGroup.vue'
import PrefNumber from './PrefNumber.vue'
import PrefRow from './PrefRow.vue'
import PrefSegmented from './PrefSegmented.vue'
import PrefSelect from './PrefSelect.vue'
import PrefSwitch from './PrefSwitch.vue'
import { systemAudioBlocked } from '@/lib/audio/service'
import { runCommand } from '@/lib/app/commands'
import { useEngine } from '@/lib/engine/engine'
import { preferences } from '@/lib/app/preferences'

const errors = reactive<Record<string, string | null>>({})
const audio = useEngine().audio.state
const trackStatus = useEngine().trackStatus
</script>

<template>
  <PrefGroup title="Startup">
    <PrefRow v-slot="{ id, labelId }" label="Show the launch screen" description="New, open, recent files and examples when the app starts. Help > Launch Screen shows it at any time.">
      <PrefSwitch :id="id" v-model="preferences.showLaunchScreen" :labelled-by="labelId" data-field="showLaunchScreen" />
    </PrefRow>
    <PrefRow v-slot="{ labelId }" label="Open in" description="The editor the app starts in.">
      <PrefSegmented
        v-model="preferences.launchMode"
        :labelled-by="labelId"
        :options="[{ value: 'shader', label: 'Shader' }, { value: 'graph', label: 'Graph' }, { value: 'last', label: 'Last used' }]"
      />
    </PrefRow>
  </PrefGroup>

  <PrefGroup title="Audio">
    <PrefRow v-slot="{ id }" label="Source on launch" :description="systemAudioBlocked() ?? 'What the audio input listens to when the app starts. A graph with an Audio Source node picks its own.'">
      <PrefSelect
        :id="id"
        v-model="preferences.audioSource"
        data-field="audioSource"
        :options="[
          { value: 'file', label: 'Track' },
          { value: 'device', label: 'Microphone or capture device' },
          ...(systemAudioBlocked() ? [] : [{ value: 'loopback' as const, label: 'System audio' }]),
        ]"
      />
    </PrefRow>
    <PrefRow label="Default track" :description="trackStatus?.level === 'info' ? trackStatus.message : `${audio.fileName}. Your own track is kept on this computer and plays instead of the built-in one.`" :error="trackStatus?.level === 'error' ? trackStatus.message : null">
      <span class="flex gap-1.5">
        <button type="button" class="pref-button" data-action="audio.fromFile" @click="runCommand('audio.fromFile')">Choose...</button>
        <button type="button" class="pref-button" data-action="audio.builtIn" :disabled="audio.fileName === 'Built-in track'" @click="runCommand('audio.builtIn')">Use Built-in</button>
      </span>
    </PrefRow>
  </PrefGroup>

  <PrefGroup title="Documents">
    <PrefRow v-slot="{ id, labelId }" label="Keep a recovery copy" description="Unsaved work is restored after a crash or an accidental close.">
      <PrefSwitch :id="id" v-model="preferences.autosave" :labelled-by="labelId" />
    </PrefRow>
    <PrefRow v-if="preferences.autosave" v-slot="{ id }" label="Recovery copy interval" description="How often the copy is refreshed while you edit." :error="errors.autosaveSeconds">
      <PrefNumber :id="id" v-model="preferences.autosaveSeconds" :min="1" :max="600" unit="s" @error="errors.autosaveSeconds = $event" />
    </PrefRow>
    <PrefRow v-slot="{ id, labelId }" label="Confirm before closing" description="Ask before closing a document with unsaved changes.">
      <PrefSwitch :id="id" v-model="preferences.confirmClose" :labelled-by="labelId" />
    </PrefRow>
  </PrefGroup>

  <PrefGroup title="Performance">
    <PrefRow v-slot="{ id }" label="Preview frame rate limit" description="Lower values save power. 0 follows the display. The LED stream has its own rate under Output." :error="errors.previewFps">
      <PrefNumber :id="id" v-model="preferences.previewFps" :min="0" :max="240" unit="fps" @error="errors.previewFps = $event" />
    </PrefRow>
    <PrefRow v-slot="{ id }" label="Preview height limit" description="Lower values shade fewer pixels. 0 follows the display. The LED output is not affected." :error="errors.previewHeight">
      <PrefNumber :id="id" v-model="preferences.previewHeight" :min="0" :max="4320" unit="px" @error="errors.previewHeight = $event" />
    </PrefRow>
    <PrefRow v-slot="{ id }" label="Log history" description="Older lines are dropped once the log is this long." :error="errors.logLines">
      <PrefNumber :id="id" v-model="preferences.logLines" :min="50" :max="10000" :step="50" unit="lines" @error="errors.logLines = $event" />
    </PrefRow>
  </PrefGroup>
</template>
