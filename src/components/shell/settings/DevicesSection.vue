<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ListboxContent, ListboxItem, ListboxRoot } from 'reka-ui'
import PrefGroup from './PrefGroup.vue'
import PrefNumber from './PrefNumber.vue'
import PrefRow from './PrefRow.vue'
import PrefSelect from './PrefSelect.vue'
import PrefSwitch from './PrefSwitch.vue'
import PrefText from './PrefText.vue'
import { activeDevice, addDevice, devices, duplicateDevice, removeDevice, setActiveDevice, updateDevice, type SavedDevice } from '@/lib/app/devices'
import { useEngine } from '@/lib/engine/engine'
import { layoutCount, parseLayout, type Layout, type Segment } from '@/lib/engine/layout'

type LayoutKind = 'strip' | 'ring' | 'matrix' | 'custom'

const { stats } = useEngine().bridge

const selectedId = ref(activeDevice.value.id)
const device = computed(() => devices.value.find((d) => d.id === selectedId.value) ?? activeDevice.value)
const isActive = computed(() => device.value.id === activeDevice.value.id)

const errors = reactive<Record<string, string | null>>({})
const customOpen = ref(false)
const customJson = ref('')

const only = computed<Segment | null>(() => {
  const segments = device.value.layout?.segments ?? []
  return segments.length === 1 ? segments[0] : null
})
const layoutKind = computed<LayoutKind>(() => {
  if (customOpen.value) return 'custom'
  if (!device.value.layout) return 'strip'
  return only.value?.kind === 'ring' || only.value?.kind === 'matrix' ? only.value.kind : 'custom'
})
const ring = computed(() => (only.value?.kind === 'ring' ? only.value : null))
const matrix = computed(() => (only.value?.kind === 'matrix' ? only.value : null))

const layoutSummary = computed(() => {
  const layout = device.value.layout
  if (!layout) return 'A straight strip sampled along the scan row of the preview.'
  if (ring.value) return `A ring of ${ring.value.count} LEDs.`
  if (matrix.value) return `A ${matrix.value.width} by ${matrix.value.height} matrix, ${layoutCount(layout)} LEDs. The LED count follows it.`
  return `${layout.segments.length} ${layout.segments.length === 1 ? 'segment' : 'segments'}, ${layoutCount(layout)} LEDs. The LED count follows it.`
})

watch(() => device.value.id, () => {
  for (const key of Object.keys(errors)) errors[key] = null
  customOpen.value = false
}, { flush: 'sync' })

const patch = (fields: Partial<Omit<SavedDevice, 'id'>>) => updateDevice(device.value.id, fields)

function validateHost(text: string) {
  if (!text) return null
  if (/^[a-z]+:\/\//i.test(text)) return 'Leave out http:// and anything after the host name.'
  return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(text) ? null : 'Enter a host name such as wled.local or an IP address such as 192.168.1.50, without a port or a path.'
}

function setLayout(layout: Layout | null): boolean {
  if (layout && !parseLayout(layout)) {
    errors.layout = 'A layout needs at least 1 and at most 4096 LEDs.'
    return false
  }
  errors.layout = null
  patch({ layout, ledCount: layout ? layoutCount(layout) : device.value.ledCount })
  return true
}

function setKind(kind: LayoutKind) {
  customOpen.value = kind === 'custom'
  if (kind === 'custom') customJson.value = device.value.layout ? JSON.stringify(device.value.layout, null, 2) : ''
  if (kind === 'strip') setLayout(null)
  if (kind === 'ring') setLayout({ segments: [{ kind: 'ring', count: device.value.ledCount, center: [0.5, 0.5], radius: 0.4, startAngle: Math.PI / 2, clockwise: true }] })
  if (kind === 'matrix') setLayout({ segments: [{ kind: 'matrix', width: 8, height: 8, serpentine: true, origin: 'top-left' }] })
}

const setSegment = (fields: Partial<Segment>) => setLayout({ segments: [{ ...only.value!, ...fields } as Segment] })

function setLedCount(count: number) {
  if (ring.value) setSegment({ count })
  else patch({ ledCount: count })
}

function commitCustom() {
  let raw: unknown
  try {
    raw = JSON.parse(customJson.value)
  } catch (e) {
    errors.custom = `Not JSON: ${(e as Error).message}`
    return
  }
  const layout = parseLayout(raw)
  if (!layout) {
    errors.custom = 'Not a layout: expected { "segments": [strip | ring | matrix | points] } with at most 4096 LEDs.'
    return
  }
  errors.custom = null
  setLayout(layout)
}

function add() {
  selectedId.value = addDevice().id
}

function duplicate() {
  const copy = duplicateDevice(device.value.id)
  if (copy) selectedId.value = copy.id
}

function remove() {
  const index = devices.value.findIndex((d) => d.id === device.value.id)
  removeDevice(device.value.id)
  selectedId.value = devices.value[Math.max(0, index - 1)].id
}

const connection = computed(() => {
  if (stats.status !== 'connected') return { dot: 'bg-error', text: stats.status === 'connecting' ? 'Connecting to the bridge...' : 'The bridge is offline, so frames cannot reach any device.' }
  if (!device.value.host) return { dot: 'bg-warning', text: 'No host set. Frames are rendered but not sent.' }
  if (!stats.device) return { dot: 'bg-(--ui-text-dimmed)', text: `No reply from ${device.value.host} yet. Art-Net and sACN receivers other than WLED never reply.` }
  const ping = stats.deviceMs == null ? '' : ` in ${Math.round(stats.deviceMs)} ms`
  return { dot: 'bg-success', text: `${stats.device.name} ${stats.device.version} answered${ping} and reports ${stats.device.ledCount} LEDs.` }
})
const reportedCount = computed(() => (isActive.value && stats.device && !device.value.layout && stats.device.ledCount !== device.value.ledCount ? stats.device.ledCount : null))
</script>

<template>
  <div class="flex min-h-0 flex-1">
    <div class="flex w-[216px] shrink-0 flex-col border-e border-(--pref-line)">
      <ListboxRoot
        :model-value="device.id"
        class="min-h-0 flex-1"
        @update:model-value="selectedId = ($event as string | undefined) ?? selectedId"
        @highlight="selectedId = ($event?.value as string | undefined) ?? selectedId"
      >
        <ListboxContent class="h-full overflow-y-auto p-1.5 outline-none" aria-label="Saved devices">
          <ListboxItem
            v-for="entry in devices"
            :key="entry.id"
            :value="entry.id"
            :data-device="entry.id"
            class="device-row flex h-[44px] cursor-default items-center gap-2 rounded-[4px] px-2 outline-none data-[state=checked]:bg-(--app-selected)"
          >
            <span class="size-[7px] shrink-0 rounded-full" :class="entry.id === activeDevice.id ? 'bg-primary' : 'border border-(--ui-border-accented)'" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[13px] text-highlighted">{{ entry.name }}</span>
              <span class="block truncate text-[11px] text-muted">{{ entry.id === activeDevice.id ? 'Active, ' : '' }}{{ entry.host || 'no host' }}</span>
            </span>
          </ListboxItem>
        </ListboxContent>
      </ListboxRoot>
      <div class="flex shrink-0 gap-1 border-t border-(--pref-line) p-1.5">
        <button type="button" class="pref-button min-w-0 flex-1 !px-0" data-action="add" @click="add">Add</button>
        <button type="button" class="pref-button min-w-0 flex-1 !px-0" data-action="duplicate" @click="duplicate">Duplicate</button>
        <button type="button" class="pref-button min-w-0 flex-1 !px-0" data-action="remove" :disabled="devices.length <= 1" :title="devices.length <= 1 ? 'The last device cannot be removed' : undefined" @click="remove">Remove</button>
      </div>
    </div>

    <div :key="device.id" class="device-detail min-w-0 flex-1 overflow-y-auto px-5 pb-5">
      <div class="flex h-[44px] items-center gap-3 border-b border-(--pref-line)">
        <h3 class="min-w-0 flex-1 truncate text-[13px] font-semibold text-highlighted">{{ device.name }}</h3>
        <span v-if="isActive" class="flex items-center gap-1.5 text-[12px] text-muted" data-state="active"><span class="size-[7px] rounded-full bg-primary" />Active device</span>
        <button v-else type="button" class="pref-button" data-action="activate" @click="setActiveDevice(device.id)">Set Active</button>
      </div>

      <PrefGroup>
        <PrefRow v-slot="{ id }" label="Name" :error="errors.name">
          <PrefText :id="id" :model-value="device.name" :validate="(text) => (text ? null : 'A device needs a name.')" @update:model-value="patch({ name: $event })" @error="errors.name = $event" />
        </PrefRow>
        <PrefRow v-slot="{ id }" label="Host" description="Host name or IP address of the WLED device." :error="errors.host">
          <PrefText :id="id" :model-value="device.host" placeholder="wled.local" :validate="validateHost" data-field="host" @update:model-value="patch({ host: $event })" @error="errors.host = $event" />
        </PrefRow>
        <PrefRow v-slot="{ id }" label="Protocol">
          <PrefSelect
            :id="id"
            :model-value="device.protocol"
            :options="[{ value: 'ddp', label: 'DDP (UDP 4048)' }, { value: 'dnrgb', label: 'WLED DNRGB (UDP 21324)' }, { value: 'artnet', label: 'Art-Net (UDP 6454)' }, { value: 'sacn', label: 'sACN / E1.31 (UDP 5568)' }]"
            @update:model-value="patch({ protocol: $event })"
          />
        </PrefRow>
        <PrefRow
          v-if="device.protocol === 'artnet' || device.protocol === 'sacn'"
          v-slot="{ id }"
          label="First universe"
          description="170 LEDs fit in one universe; longer strips continue in the next. sACN universes start at 1."
          :error="errors.universe"
        >
          <PrefNumber :id="id" :model-value="device.universe" :min="0" :max="32767" data-field="universe" @update:model-value="patch({ universe: $event })" @error="errors.universe = $event" />
        </PrefRow>
      </PrefGroup>

      <PrefGroup title="LEDs">
        <PrefRow v-slot="{ id }" label="LED count" :error="errors.ledCount">
          <PrefNumber :id="id" :model-value="device.ledCount" :min="1" :max="4096" :disabled="layoutKind === 'matrix' || layoutKind === 'custom'" data-field="ledCount" @update:model-value="setLedCount" @error="errors.ledCount = $event" />
        </PrefRow>
        <PrefRow v-slot="{ id }" label="Layout" :description="layoutSummary" :error="errors.layout">
          <PrefSelect
            :id="id"
            :model-value="layoutKind"
            :options="[{ value: 'strip', label: 'Straight strip' }, { value: 'ring', label: 'Ring' }, { value: 'matrix', label: 'Matrix' }, { value: 'custom', label: 'Custom (JSON)' }]"
            @update:model-value="setKind"
          />
        </PrefRow>
        <template v-if="ring && layoutKind === 'ring'">
          <PrefRow v-slot="{ id }" label="Radius" description="As a fraction of the preview height." :error="errors.radius">
            <PrefNumber :id="id" :model-value="ring.radius" :min="0.01" :max="0.5" :step="0.01" @update:model-value="setSegment({ radius: $event })" @error="errors.radius = $event" />
          </PrefRow>
          <PrefRow v-slot="{ id }" label="First LED at" :error="errors.startAngle">
            <PrefNumber :id="id" :model-value="Math.round((ring.startAngle * 180) / Math.PI)" :min="-360" :max="360" unit="deg" @update:model-value="setSegment({ startAngle: ($event * Math.PI) / 180 })" @error="errors.startAngle = $event" />
          </PrefRow>
          <PrefRow v-slot="{ id, labelId }" label="Clockwise">
            <PrefSwitch :id="id" :model-value="ring.clockwise" :labelled-by="labelId" @update:model-value="setSegment({ clockwise: $event })" />
          </PrefRow>
        </template>
        <template v-if="matrix && layoutKind === 'matrix'">
          <PrefRow v-slot="{ id }" label="Columns" :error="errors.width">
            <PrefNumber :id="id" :model-value="matrix.width" :min="1" :max="256" @update:model-value="setSegment({ width: $event })" @error="errors.width = $event" />
          </PrefRow>
          <PrefRow v-slot="{ id }" label="Rows" :error="errors.height">
            <PrefNumber :id="id" :model-value="matrix.height" :min="1" :max="256" @update:model-value="setSegment({ height: $event })" @error="errors.height = $event" />
          </PrefRow>
          <PrefRow v-slot="{ id }" label="First LED">
            <PrefSelect :id="id" :model-value="matrix.origin" :options="[{ value: 'top-left', label: 'Top left' }, { value: 'bottom-left', label: 'Bottom left' }]" @update:model-value="setSegment({ origin: $event })" />
          </PrefRow>
          <PrefRow v-slot="{ id, labelId }" label="Serpentine wiring" description="Every other row runs backwards.">
            <PrefSwitch :id="id" :model-value="matrix.serpentine" :labelled-by="labelId" @update:model-value="setSegment({ serpentine: $event })" />
          </PrefRow>
        </template>
        <div v-if="layoutKind === 'custom'" class="py-2">
          <label for="device-layout-json" class="pref-label">Layout JSON</label>
          <p class="pref-hint">Segments in wire order. Points are [x, y] or [x, y, z] from 0 to 1, y up. Applied when you leave the field.</p>
          <textarea id="device-layout-json" v-model="customJson" rows="7" spellcheck="false" class="pref-input mt-1.5 h-auto w-full py-1.5 font-mono text-[12px] leading-[1.5]" @change="commitCustom" />
          <p v-if="errors.custom" role="alert" class="pref-error">{{ errors.custom }}</p>
        </div>
      </PrefGroup>

      <PrefGroup title="Connection">
        <div class="flex min-h-[40px] items-center gap-2 py-2 text-[13px]" data-field="connection">
          <template v-if="isActive">
            <span class="size-[7px] shrink-0 rounded-full" :class="connection.dot" />
            <span class="min-w-0 flex-1 select-text">{{ connection.text }}</span>
            <button v-if="reportedCount" type="button" class="pref-button" @click="patch({ ledCount: reportedCount })">Use {{ reportedCount }} LEDs</button>
          </template>
          <span v-else class="text-muted">Only the active device is connected. Set this one active to check it.</span>
        </div>
      </PrefGroup>
    </div>
  </div>
</template>
