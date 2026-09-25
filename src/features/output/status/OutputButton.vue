<script setup lang="ts">
import { computed, ref } from 'vue'
import LiveIndicator from './LiveIndicator.vue'
import { useEngine } from '@/lib/engine/engine'
import { config } from '@/lib/app/config'
import { activeDevice, addDevice, devices, setActiveDevice } from '@/lib/app/devices'
import { openSettings } from '@/lib/app/preferences'

const engine = useEngine()
const { stats } = engine.bridge
const streaming = engine.streaming

const idle = computed(() => {
  if (stats.status === 'disconnected') return { dot: 'bg-error', hint: 'Bridge offline: frames will not reach the device' }
  if (!config.host) return { dot: 'bg-warning', hint: 'No device set' }
  return { dot: 'bg-(--ui-text-dimmed)', hint: 'Start streaming to the device' }
})

const popoverOpen = ref(false)
const deviceButton = ref<HTMLButtonElement>()

// the popover closes first: its buttons are gone by the time the view closes, so focus returns to the button that opened it
function openDeviceSettings() {
  popoverOpen.value = false
  openSettings('devices', deviceButton.value)
}

function addAndConfigure() {
  addDevice()
  openDeviceSettings()
}
</script>

<template>
  <div
    class="output flex h-[26px] shrink-0 items-stretch overflow-hidden rounded-[4px] border text-[12px]"
    :class="streaming ? 'border-primary/60 bg-primary/10' : 'border-accented'"
  >
    <UTooltip :text="streaming ? 'Stop streaming' : idle.hint">
      <button type="button" class="flex items-center gap-1.5 px-2.5 hover:bg-(--app-hover)" :aria-pressed="streaming" @click="engine.toggleStream()">
        <LiveIndicator v-if="streaming" />
        <template v-else>
          <span class="size-[7px] rounded-full" :class="idle.dot" />
          <span class="font-semibold text-highlighted">Stream</span>
        </template>
      </button>
    </UTooltip>
    <UPopover v-model:open="popoverOpen">
      <button
        ref="deviceButton"
        type="button"
        class="flex min-w-0 items-center gap-1 border-s px-2 text-muted hover:bg-(--app-hover) hover:text-default"
        :class="streaming ? 'border-primary/60' : 'border-accented'"
      >
        <span class="max-w-[120px] truncate">{{ config.host || 'no device' }}</span>
        <UIcon name="i-lucide-chevron-down" class="size-3 shrink-0" />
      </button>
      <template #content>
        <div class="w-56 p-3 text-[12px]">
          <ul class="space-y-0.5">
            <li v-for="device in devices" :key="device.id">
              <button
                type="button"
                class="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-start hover:bg-(--app-hover)"
                :class="device.id === activeDevice.id ? 'text-highlighted font-medium' : 'text-muted'"
                @click="setActiveDevice(device.id)"
              >
                <span class="size-[6px] shrink-0 rounded-full" :class="device.id === activeDevice.id ? 'bg-primary' : 'bg-transparent'" />
                <span class="truncate">{{ device.name }}</span>
              </button>
            </li>
          </ul>
          <UButton label="Add device..." color="neutral" variant="ghost" size="xs" block class="mt-1" @click="addAndConfigure" />
          <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-accented pt-3">
            <dt class="text-muted">Device</dt>
            <dd class="truncate text-highlighted">{{ stats.device ? `${stats.device.name} ${stats.device.version}` : 'Not detected' }}</dd>
            <dt class="text-muted">Host</dt>
            <dd class="truncate select-text">{{ config.host || 'Not set' }}</dd>
            <dt class="text-muted">Protocol</dt>
            <dd>{{ config.protocol.toUpperCase() }}</dd>
            <dt class="text-muted">LEDs</dt>
            <dd class="tabular-nums">{{ config.ledCount }}</dd>
            <dt class="text-muted">Frame rate</dt>
            <dd class="tabular-nums">{{ config.fps }} fps</dd>
          </dl>
          <UButton label="Device settings..." color="neutral" variant="subtle" size="xs" block class="mt-3" @click="openDeviceSettings" />
        </div>
      </template>
    </UPopover>
  </div>
</template>
