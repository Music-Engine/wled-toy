<script setup lang="ts">
import { ref } from 'vue'
import PrefGroup from '@/ui/primitives/PrefGroup.vue'
import PrefRow from '@/ui/primitives/PrefRow.vue'
import { isEnabled, getCommand, runCommand } from '@/lib/app/commands'
import { resetStoredData } from '@/lib/app/config'
import { resetPreferences } from '@/lib/app/preferences'

const confirmingReset = ref(false)
const can = (id: string) => !!getCommand(id) && isEnabled(getCommand(id)!)
</script>

<template>
  <PrefGroup title="Config file">
    <PrefRow label="Export config" description="Saves the shader, the graph, the output settings and every saved device to a JSON file. Preferences and window layout stay on this computer.">
      <button type="button" class="pref-button" :disabled="!can('config.export')" @click="runCommand('config.export')">Export Config...</button>
    </PrefRow>
    <PrefRow label="Import config" description="Replaces the current work and the saved devices with the contents of an exported file.">
      <button type="button" class="pref-button" :disabled="!can('config.import')" @click="runCommand('config.import')">Import Config...</button>
    </PrefRow>
  </PrefGroup>

  <PrefGroup title="Reset">
    <PrefRow label="Reset layout" description="Puts every panel back in its default place and size.">
      <button type="button" class="pref-button" @click="runCommand('view.resetLayout')">Reset Layout</button>
    </PrefRow>
    <PrefRow label="Reset preferences" description="Restores the defaults of General and Appearance. Devices and documents are untouched.">
      <button type="button" class="pref-button" @click="resetPreferences()">Reset Preferences</button>
    </PrefRow>
    <PrefRow
      label="Reset saved data"
      :description="confirmingReset ? undefined : 'Forgets devices, preferences, layout, the shader, the graph, your song and your images, then reloads.'"
      :error="confirmingReset ? 'This cannot be undone. Export a config first to keep your devices and work.' : null"
    >
      <span v-if="confirmingReset" class="flex gap-1.5">
        <button type="button" class="pref-button" @click="confirmingReset = false">Cancel</button>
        <button type="button" class="pref-button pref-button-danger" data-action="confirm-reset" @click="resetStoredData()">Reset and Reload</button>
      </span>
      <button v-else type="button" class="pref-button pref-button-danger" data-action="reset" @click="confirmingReset = true">Reset Saved Data...</button>
    </PrefRow>
  </PrefGroup>
</template>

<style scoped>
.pref-button-danger {
  color: var(--ui-error);
}
</style>
