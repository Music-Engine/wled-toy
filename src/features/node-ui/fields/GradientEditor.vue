<script setup lang="ts">
import { computed } from 'vue'
import ColorSwatch from './ColorSwatch.vue'
import DropdownField from './DropdownField.vue'
import RangeField from './RangeField.vue'
import { useGradientEditor } from './use-gradient-editor'
import { RAMP_INTERPOLATIONS, sampleRamp, type ColorRamp, type RampInterpolation } from '@/lib/graph'
import './fields.css'

const props = defineProps<{ modelValue: ColorRamp }>()
const emit = defineEmits<{ 'update:modelValue': [value: ColorRamp] }>()

const { bar, selected, stops, current, updateCurrent, addStop, removeStop, positionAt, onStopDown, onStopMove, onStopUp } = useGradientEditor(
  () => props.modelValue,
  (next) => emit('update:modelValue', next),
)

const css = (c: number[]) =>
  `rgb(${c
    .slice(0, 3)
    .map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255))
    .join(' ')})`
const gradient = computed(() => {
  const samples = Array.from({ length: 49 }, (_, i) => `${css(sampleRamp(props.modelValue, i / 48))} ${(i / 48) * 100}%`)
  return `linear-gradient(to right, ${samples.join(', ')})`
})
// the dashed marker must stay visible on any stop color
const contrast = (c: number[]) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.5 ? '#000' : '#fff')
</script>

<template>
  <div class="nui-gradient nodrag">
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
        @pointermove="onStopMove"
        @pointerup="onStopUp"
      />
    </div>

    <div class="nui-gradient-fields">
      <RangeField :model-value="Math.min(selected, stops.length - 1)" label="Stop" :min="0" :max="stops.length - 1" :step="1" :decimals="0" @update:model-value="selected = $event" />
      <RangeField :model-value="current.position" label="Pos" :min="0" :max="1" @update:model-value="updateCurrent({ position: $event })" />
    </div>
    <ColorSwatch :model-value="current.color" @update:model-value="updateCurrent({ color: $event })" />
  </div>
</template>

<style>
.nui-gradient { display: flex; flex-direction: column; gap: var(--nui-gap); }
.nui-gradient-track { position: relative; padding-bottom: 1.3em; }
.nui-gradient-bar {
  height: var(--nui-field-height);
  border-radius: var(--nui-radius);
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.5);
}
.nui-gradient-stop {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 1px dashed;
  cursor: grab;
}
.nui-gradient-stop::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  width: 1.1em;
  height: 1.1em;
  border: 1px solid var(--nui-text);
  border-radius: 50%;
  background: var(--stop-color);
  transform: translateX(-50%);
}
.nui-gradient-stop.is-selected::after { border-style: dashed; box-shadow: 0 0 0 1px #000; }
.nui-gradient-fields { display: grid; grid-template-columns: 1fr 1fr; gap: var(--nui-gap); }
</style>
