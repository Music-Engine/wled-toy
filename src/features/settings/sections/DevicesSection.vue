<script setup lang="ts">
import { ListboxContent, ListboxItem, ListboxRoot } from 'reka-ui'
import PrefGroup from '@/ui/primitives/PrefGroup.vue'
import PrefNumber from '@/ui/primitives/PrefNumber.vue'
import PrefRow from '@/ui/primitives/PrefRow.vue'
import PrefSelect from '@/ui/primitives/PrefSelect.vue'
import PrefSwitch from '@/ui/primitives/PrefSwitch.vue'
import PrefText from '@/ui/primitives/PrefText.vue'
import { useDeviceForm } from '@/features/settings/use-device-form'
import { activeDevice, devices, setActiveDevice, validateHost } from '@/lib/app/devices'

const { selectedId, device, isActive, errors, customJson, layoutKind, layoutSummary, ring, matrix, patch, setKind, setSegment, setLedCount, commitCustom, add, duplicate, remove, connection, reportedCount } = useDeviceForm()
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
