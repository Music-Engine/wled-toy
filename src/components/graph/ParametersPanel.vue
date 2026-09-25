<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import RangeField from '@/features/node-ui/fields/RangeField.vue'
// the knob and scene rows are drawn with the node look, and this panel can be open before any node has rendered
import '@/features/node-ui/node-ui.css'
import InspectorRow from '@/components/shell/InspectorRow.vue'
import InspectorSection from '@/components/shell/InspectorSection.vue'
import { useEngine } from '@/lib/engine/engine'
import { isTauri } from '@/lib/app/platform'
import { captureScene, fadeScene, type GraphNodeData, type Scene, type SocketValue, type StoredNode } from '@/lib/graph'

const props = defineProps<{ flowId: string }>()
const scenes = defineModel<Scene[]>('scenes', { required: true })
const { nodes, updateNodeData } = useVueFlow(props.flowId)
const engine = useEngine()
const { midi } = engine

interface Knob {
  id: string
  label: string
  value: number
  min: number
  max: number
  cc: number
}

const knobs = computed<Knob[]>(() => nodes.value
  .filter((n) => (n.data as GraphNodeData).kind === 'knob')
  .map((n) => {
    const values = (n.data as GraphNodeData).values as Record<string, number | string | undefined>
    return { id: n.id, label: String(values.label ?? 'Knob'), value: Number(values.value ?? 0.5), min: Number(values.min ?? 0), max: Number(values.max ?? 1), cc: Number(values.cc ?? -1) }
  }))

function set(id: string, patch: Record<string, SocketValue>) {
  const node = nodes.value.find((n) => n.id === id)
  if (node) updateNodeData<GraphNodeData>(id, { values: { ...(node.data as GraphNodeData).values, ...patch } })
}

// the knob waiting for a controller to be moved, if any
const learning = ref<string | null>(null)

async function learn(id: string) {
  if (learning.value === id) {
    learning.value = null
    return
  }
  await midi.enable()
  if (midi.state.enabled) learning.value = id
}

// a bound controller writes into the node, so the panel, the node and the saved graph all show where the hardware is
const stop = midi.onMessage((message) => {
  if (message.kind !== 'cc') return
  if (learning.value) {
    set(learning.value, { cc: message.number })
    learning.value = null
  }
  for (const knob of knobs.value) {
    if (knob.cc === message.number) set(knob.id, { value: Number((knob.min + (knob.max - knob.min) * message.value).toFixed(4)) })
  }
})

const fadeSeconds = ref(0.5)
const activeScene = ref<string | null>(null)
// a timer, not requestAnimationFrame: the LEDs keep running in a hidden tab, and a fade must finish there too
let fadeTimer: ReturnType<typeof setTimeout> | undefined

function saveScene() {
  const scene = captureScene(nodes.value as unknown as StoredNode[], `Scene ${scenes.value.length + 1}`)
  scenes.value = [...scenes.value, scene]
  activeScene.value = scene.id
}

/** Moves every knob to the scene over `seconds`. A new recall takes over from wherever the last one had got to. */
function recall(scene: Scene, seconds = fadeSeconds.value) {
  clearTimeout(fadeTimer)
  activeScene.value = scene.id
  const from = Object.fromEntries(knobs.value.map((k) => [k.id, k.value]))
  const started = performance.now()
  const tick = () => {
    const t = seconds <= 0 ? 1 : (performance.now() - started) / 1000 / seconds
    for (const [id, value] of Object.entries(fadeScene(from, scene, t))) set(id, { value })
    if (t < 1) fadeTimer = setTimeout(tick, 16)
  }
  tick()
}

// a Scene Switch node asks for a scene by index; act when the index it puts out changes
let lastRequested = -1
const switchPoll = setInterval(() => {
  const node = nodes.value.find((n) => (n.data as GraphNodeData).kind === 'sceneSwitch')
  const requested = node && engine.controlOutput(node.id, 'scene')
  if (typeof requested !== 'number' || requested === lastRequested) return
  lastRequested = requested
  const scene = scenes.value[requested % Math.max(1, scenes.value.length)]
  if (scene) recall(scene, Number((node!.data as GraphNodeData).values.fade ?? 0.5))
}, 1000 / 30)

onBeforeUnmount(() => {
  stop()
  clearInterval(switchPoll)
  clearTimeout(fadeTimer)
})
</script>

<template>
  <div v-if="knobs.length" class="nui nui-parameters">
    <InspectorSection title="Knobs">
      <InspectorRow v-for="knob in knobs" :key="knob.id" :label="knob.label">
        <RangeField :model-value="knob.value" :min="knob.min" :max="knob.max" @update:model-value="set(knob.id, { value: $event })" />
        <button
          type="button"
          class="nui-button nui-parameters-learn"
          :disabled="!midi.state.available"
          :title="midi.state.available ? 'Bind a MIDI controller: click, then move it' : isTauri() ? 'MIDI is not available in the desktop app yet' : 'This browser has no Web MIDI'"
          @click="learn(knob.id)"
        >
          {{ learning === knob.id ? '...' : knob.cc >= 0 ? `CC ${knob.cc}` : 'Learn' }}
        </button>
      </InspectorRow>
    </InspectorSection>

    <InspectorSection title="Scenes">
      <InspectorRow v-for="(scene, index) in scenes" :key="scene.id" :label="String(index)">
        <label class="nui-field nui-text">
          <input class="nui-input" :value="scene.name" :aria-label="`Name of scene ${index}`" spellcheck="false" @change="scenes = scenes.map((s) => (s.id === scene.id ? { ...s, name: ($event.target as HTMLInputElement).value } : s))">
        </label>
        <button type="button" class="nui-button nui-scene-recall" :class="{ 'is-active': scene.id === activeScene }" :title="`Recall scene ${index}`" @click="recall(scene)">{{ index }}</button>
        <button type="button" class="nui-button nui-parameters-learn" :aria-label="`Delete scene ${scene.name}`" @click="scenes = scenes.filter((s) => s.id !== scene.id)">Delete</button>
      </InspectorRow>
      <InspectorRow label="Fade (s)">
        <RangeField v-model="fadeSeconds" :min="0" :max="10" :decimals="2" />
      </InspectorRow>
      <InspectorRow label="">
        <button type="button" class="nui-button nui-scene-save" @click="saveScene">Save Scene</button>
      </InspectorRow>
    </InspectorSection>
  </div>
</template>
