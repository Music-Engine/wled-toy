<script setup lang="ts">
import { ref } from 'vue'
import PrefGroup from '@/ui/primitives/PrefGroup.vue'
import PrefNumber from '@/ui/primitives/PrefNumber.vue'
import PrefRow from '@/ui/primitives/PrefRow.vue'
import { config } from '@/lib/app/config'
import { Format } from '@/lib/util/format'

const fpsError = ref<string | null>(null)
</script>

<template>
  <PrefGroup title="Stream">
    <PrefRow v-slot="{ id }" label="Frame rate" description="Frames sent to the active device each second. A graph's Output node can override it." :error="fpsError">
      <PrefNumber :id="id" v-model="config.fps" :min="1" :max="120" unit="fps" data-field="fps" @error="fpsError = $event" />
    </PrefRow>
    <PrefRow v-slot="{ id }" label="Scan row" description="The row of the preview a straight strip samples, from 0 to 1. Devices with a layout ignore it.">
      <span class="flex w-full items-center gap-2">
        <input :id="id" v-model.number="config.scanY" type="range" min="0" max="1" step="0.01" class="pref-range min-w-0 flex-1">
        <span class="w-[34px] text-end text-[12px] tabular-nums text-muted">{{ Format.fixed(config.scanY, 2) }}</span>
      </span>
    </PrefRow>
  </PrefGroup>
</template>
