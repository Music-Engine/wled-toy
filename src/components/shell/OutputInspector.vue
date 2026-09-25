<script setup lang="ts">
import { computed } from 'vue'
import InspectorRow from './InspectorRow.vue'
import InspectorSection from './InspectorSection.vue'
import { runCommand } from '@/lib/app/commands'
import { config, type Protocol } from '@/lib/app/config'
import { activeDeviceId, devices } from '@/lib/app/devices'
import { openSettings } from '@/lib/app/preferences'
import { useEngine } from '@/lib/engine/engine'
import { Format } from '@/lib/util/format'

const { stats } = useEngine().bridge

const layout = computed(() => (config.layout
  ? config.layout.segments.map((s) => (s.kind === 'matrix' ? `matrix ${s.width}x${s.height}` : s.kind)).join(', ')
  : 'strip'))

function setNumber(key: 'fps' | 'universe', min: number, max: number, e: Event) {
  const input = e.target as HTMLInputElement
  const value = Number(input.value)
  if (input.value !== '' && Number.isFinite(value)) config[key] = Math.min(max, Math.max(min, Math.round(value)))
  input.value = String(config[key])
}
</script>

<template>
  <div class="output-inspector">
    <InspectorSection title="Frame">
      <InspectorRow label="Brightness">
        <input
          type="range"
          class="app-slider"
          min="0"
          max="1"
          step="0.01"
          aria-label="Brightness"
          data-control="brightness"
          :value="config.brightness"
          :style="{ '--fill': `${config.brightness * 100}%` }"
          @input="config.brightness = Number(($event.target as HTMLInputElement).value)"
        >
        <span class="w-9 shrink-0 text-end font-mono tabular-nums text-default">{{ Math.round(config.brightness * 100) }}%</span>
      </InspectorRow>
      <!-- with a layout the LEDs sit where it puts them, and no scan row is sampled -->
      <InspectorRow v-if="!config.layout" label="Scan row">
        <input
          type="range"
          class="app-slider"
          min="0"
          max="1"
          step="0.01"
          aria-label="Scan row"
          data-control="scanY"
          :value="config.scanY"
          :style="{ '--fill': `${config.scanY * 100}%` }"
          @input="config.scanY = Number(($event.target as HTMLInputElement).value)"
        >
        <span class="w-9 shrink-0 text-end font-mono tabular-nums text-default">{{ Format.fixed(config.scanY, 2) }}</span>
      </InspectorRow>
      <InspectorRow label="Target rate">
        <input type="number" class="app-field w-14 text-end" min="1" max="120" aria-label="Target rate" data-control="fps" :value="config.fps" @change="setNumber('fps', 1, 120, $event)">
        <span class="text-dimmed">fps</span>
      </InspectorRow>
    </InspectorSection>

    <InspectorSection title="Device">
      <InspectorRow label="Send to">
        <select class="app-field min-w-0 flex-1" aria-label="Device" data-control="device" :value="activeDeviceId" @change="runCommand(`output.device.${($event.target as HTMLSelectElement).value}`)">
          <option v-for="device in devices" :key="device.id" :value="device.id">{{ device.name }}</option>
        </select>
      </InspectorRow>
      <InspectorRow label="Host">
        <span class="truncate select-text" :class="config.host ? 'text-default' : 'text-dimmed'">{{ config.host || 'Not set' }}</span>
      </InspectorRow>
      <InspectorRow label="Detected">
        <span class="truncate" :class="stats.device ? 'text-default' : 'text-dimmed'">{{ stats.device ? `${stats.device.name} ${stats.device.version}` : 'Not detected' }}</span>
      </InspectorRow>
      <InspectorRow label="LEDs">
        <span class="truncate tabular-nums text-default">{{ config.ledCount }}, {{ layout }}</span>
        <button type="button" class="app-button ms-auto" @click="openSettings('devices', $event.currentTarget as HTMLElement)">Edit...</button>
      </InspectorRow>
      <InspectorRow label="Protocol">
        <select class="app-field min-w-0 flex-1" aria-label="Protocol" data-control="protocol" :value="config.protocol" @change="config.protocol = ($event.target as HTMLSelectElement).value as Protocol">
          <option value="ddp">DDP (UDP 4048)</option>
          <option value="dnrgb">WLED DNRGB (UDP 21324)</option>
          <option value="artnet">Art-Net (UDP 6454)</option>
          <option value="sacn">sACN / E1.31 (UDP 5568)</option>
        </select>
      </InspectorRow>
      <InspectorRow v-if="config.protocol === 'artnet' || config.protocol === 'sacn'" label="First universe">
        <input type="number" class="app-field w-16 text-end" min="0" max="32767" aria-label="First universe" data-control="universe" :value="config.universe" @change="setNumber('universe', 0, 32767, $event)">
      </InspectorRow>
    </InspectorSection>
  </div>
</template>
