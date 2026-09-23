<script setup lang="ts">
import { computed, ref } from 'vue'
import ColorSwatch from './ColorSwatch.vue'
import DropdownField from './DropdownField.vue'
import RangeField from './RangeField.vue'
import { RAMP_INTERPOLATIONS, sampleRamp, type ColorRamp, type RampInterpolation, type RampStop } from '@/lib/graph/nodes/color/color-ramp'

const props = defineProps<{ modelValue: ColorRamp }>()
const emit = defineEmits<{ 'update:modelValue': [value: ColorRamp] }>()

const bar = ref<HTMLElement>()
const selected = ref(0)
let dragging = false

// stops are kept ordered, so a stop's index is its place along the bar and neighbors bound a drag
const stops = computed(() => [...props.modelValue.stops].sort((a, b) => a.position - b.position))
const current = computed(() => stops.value[Math.min(selected.value, stops.value.length - 1)])

const css = (c: number[]) => `rgb(${c.slice(0, 3).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(' ')})`
const gradient = computed(() => {
  const samples = Array.from({ length: 49 }, (_, i) => `${css(sampleRamp(props.modelValue, i / 48))} ${(i / 48) * 100}%`)
  return `linear-gradient(to right, ${samples.join(', ')})`
})
// the dashed marker must stay visible on any stop color
const contrast = (c: number[]) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.5 ? '#000' : '#fff')

function commit(next: RampStop[], select: RampStop) {
  const ordered = [...next].sort((a, b) => a.position - b.position)
  emit('update:modelValue', { ...props.modelValue, stops: ordered })
  selected.value = ordered.indexOf(select)
}

function updateCurrent(patch: Partial<RampStop>) {
  const index = stops.value.indexOf(current.value)
  const low = stops.value[index - 1]?.position ?? 0
  const high = stops.value[index + 1]?.position ?? 1
  const position = patch.position === undefined ? current.value.position : Math.min(high, Math.max(low, patch.position))
  const stop = { ...current.value, ...patch, position }
  commit(stops.value.map((s, i) => (i === index ? stop : s)), stop)
}

function addStop(position?: number) {
  const index = stops.value.indexOf(current.value)
  const next = stops.value[index + 1]
  const at = position ?? (next ? (current.value.position + next.position) / 2 : Math.min(1, current.value.position + 0.1))
  const stop = { position: at, color: sampleRamp(props.modelValue, at) }
  commit([...stops.value, stop], stop)
}

function removeStop() {
  if (stops.value.length <= 2) return
  const index = stops.value.indexOf(current.value)
  const rest = stops.value.filter((_, i) => i !== index)
  commit(rest, rest[Math.max(0, index - 1)])
}

function positionAt(clientX: number) {
  const rect = bar.value!.getBoundingClientRect()
  return Math.round(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * 1000) / 1000
}

function onStopDown(index: number, e: PointerEvent) {
  selected.value = index
  dragging = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
</script>

<template>
  <div class="nui-gradient nodrag nowheel">
    <div class="nui-inline">
      <div class="nui-button-group">
        <button type="button" class="nui-button" aria-label="Add stop" @click="addStop()">
          <svg viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" /></svg>
        </button>
        <button type="button" class="nui-button" aria-label="Remove stop" :disabled="stops.length <= 2" @click="removeStop">
          <svg viewBox="0 0 12 12"><path d="M1 6h10" /></svg>
        </button>
      </div>
      <DropdownField
        :model-value="modelValue.interpolation"
        :options="RAMP_INTERPOLATIONS"
        label="Interpolation"
        @update:model-value="emit('update:modelValue', { ...modelValue, interpolation: $event as RampInterpolation })"
      />
    </div>

    <div class="nui-gradient-track">
      <div ref="bar" class="nui-gradient-bar" :style="{ background: gradient }" title="Double-click to add a stop" @dblclick="addStop(positionAt($event.clientX))" />
      <div
        v-for="(stop, index) in stops"
        :key="index"
        class="nui-gradient-stop"
        :class="{ 'is-selected': stop === current }"
        :style="{ left: `${stop.position * 100}%`, color: contrast(stop.color), '--stop-color': css(stop.color) }"
        role="slider"
        :aria-label="`Stop ${index + 1}`"
        :aria-valuenow="stop.position"
        @pointerdown="onStopDown(index, $event)"
        @pointermove="dragging && updateCurrent({ position: positionAt($event.clientX) })"
        @pointerup="dragging = false"
      />
    </div>

    <div class="nui-gradient-fields">
      <RangeField :model-value="Math.min(selected, stops.length - 1)" label="Stop" :min="0" :max="stops.length - 1" :step="1" :decimals="0" @update:model-value="selected = $event" />
      <RangeField :model-value="current.position" label="Pos" :min="0" :max="1" @update:model-value="updateCurrent({ position: $event })" />
    </div>
    <ColorSwatch :model-value="current.color" @update:model-value="updateCurrent({ color: $event })" />
  </div>
</template>
