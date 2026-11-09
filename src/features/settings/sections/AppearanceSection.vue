<script setup lang="ts">
import { computed, ref } from 'vue'
import PrefGroup from '@/ui/primitives/PrefGroup.vue'
import PrefNumber from '@/ui/primitives/PrefNumber.vue'
import PrefRow from '@/ui/primitives/PrefRow.vue'
import PrefSegmented from '@/ui/primitives/PrefSegmented.vue'
import PrefSwitch from '@/ui/primitives/PrefSwitch.vue'
import { getCommand, isChecked, runCommand } from '@/lib/app/commands'
import { preferences } from '@/lib/app/settings/preferences'

type Theme = 'light' | 'dark' | 'auto'

// the View > Theme commands own the color mode; going through them keeps the menu checkmarks and this control on one source
const theme = computed<Theme>({
  get: () => (['light', 'dark', 'auto'] as const).find((value) => isChecked(getCommand(`view.theme.${value}`)!)) ?? 'auto',
  set: (value) => void runCommand(`view.theme.${value}`),
})

const fontError = ref<string | null>(null)
</script>

<template>
  <PrefGroup title="Theme">
    <PrefRow v-slot="{ labelId }" label="Color theme" description="System follows the operating system. The node editor stays dark in every theme.">
      <PrefSegmented v-model="theme" :labelled-by="labelId" :options="[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'auto', label: 'System' }]" />
    </PrefRow>
  </PrefGroup>

  <PrefGroup title="Text and spacing">
    <PrefRow v-slot="{ labelId }" label="Interface density" description="Scales panels, menus and node parameters. Compact is 13 px, Default 14 px, Comfortable 15 px.">
      <PrefSegmented
        v-model="preferences.density"
        :labelled-by="labelId"
        :options="[{ value: 'compact', label: 'Compact' }, { value: 'default', label: 'Default' }, { value: 'comfortable', label: 'Comfortable' }]"
      />
    </PrefRow>
    <PrefRow v-slot="{ id }" label="Code editor font size" :error="fontError">
      <PrefNumber :id="id" v-model="preferences.editorFontSize" :min="10" :max="24" unit="px" @error="fontError = $event" />
    </PrefRow>
  </PrefGroup>

  <PrefGroup title="Motion">
    <PrefRow v-slot="{ id, labelId }" label="Reduce motion" description="Turns off transitions and the pulsing Live dot. The preview and the LEDs keep animating.">
      <PrefSwitch :id="id" v-model="preferences.reduceMotion" :labelled-by="labelId" />
    </PrefRow>
  </PrefGroup>
</template>
