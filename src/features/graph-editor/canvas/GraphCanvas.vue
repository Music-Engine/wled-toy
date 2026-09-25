<script setup lang="ts">
import { computed, markRaw, provide, ref, type Ref } from 'vue'
import { SelectionMode, VueFlow, useVueFlow, type Edge, type GraphNode as FlowNode, type Node } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import GraphNode from '@/features/node-ui/GraphNode.vue'
import { connectedHandlesKey } from '@/features/node-ui/graph-context'
import type { GraphEditSession } from '@/lib/documents/graph-session'
import { GRAPH_NODE_TYPE, nodeItem, type GraphNodeData } from '@/lib/graph'
import { categoryById } from '@/lib/shader/glsl'
import { useCanvasPointer } from './use-canvas-pointer'
import type { PendingLink } from './use-link-drag'
import './canvas.css'

const props = defineProps<{ flowId: string; session: GraphEditSession }>()
const emit = defineEmits<{ offerNodes: [at: { x: number; y: number }, pending: PendingLink | null] }>()

const flow = useVueFlow(props.flowId)
const nodeTypes = { [GRAPH_NODE_TYPE]: markRaw(GraphNode) }
// Vue Flow's element types are too deep for UnwrapRef, so the refs are typed directly
const nodes = props.session.nodes as unknown as Ref<Node<GraphNodeData>[]>
const edges = props.session.edges as unknown as Ref<Edge[]>
const el = ref<HTMLElement>()
const pointer = useCanvasPointer(flow, el, (at, pending) => emit('offerNodes', at, pending))

let handlesByNode = new Map<string, ReadonlySet<string>>()
const connectedHandles = computed(() => {
  const next = new Map<string, Set<string>>()
  for (const edge of flow.edges.value) {
    if (!edge.targetHandle) continue
    const set = next.get(edge.target)
    if (set) set.add(edge.targetHandle)
    else next.set(edge.target, new Set([edge.targetHandle]))
  }
  const kept = new Map<string, ReadonlySet<string>>()
  for (const [id, set] of next) {
    const before = handlesByNode.get(id)
    // handing back the same set keeps a node whose links did not change from re-rendering
    kept.set(id, before && before.size === set.size && [...set].every((handle) => before.has(handle)) ? before : set)
  }
  handlesByNode = kept
  return kept
})
provide(connectedHandlesKey, connectedHandles)

const minimapColor = (node: FlowNode) => {
  const kind = (node.data as GraphNodeData | undefined)?.kind ?? ''
  const category = nodeItem(kind)?.category
  return (category && categoryById.get(category)?.color) || '#555'
}

function onPaneContextMenu(e: MouseEvent) {
  e.preventDefault()
  emit('offerNodes', { x: e.clientX, y: e.clientY }, null)
}

defineExpose({ pointerAt: pointer.pointerAt, rect: () => el.value?.getBoundingClientRect() })
</script>

<template>
  <div
    ref="el"
    class="relative min-h-0 flex-1"
    @pointermove="pointer.track"
    @pointerleave="pointer.leave"
    @pointerdown.capture="pointer.noteSelection"
    @mousedown.capture="pointer.onZoomDragStart"
  >
    <VueFlow
      :id="flowId"
      v-model:nodes="nodes"
      v-model:edges="edges"
      :node-types="nodeTypes"
      :is-valid-connection="pointer.isValidConnection"
      :delete-key-code="null"
      :selection-key-code="true"
      :pan-on-drag="[1]"
      :selection-mode="SelectionMode.Partial"
      multi-selection-key-code="Shift"
      :pan-activation-key-code="null"
      :zoom-activation-key-code="null"
      :zoom-on-scroll="false"
      :zoom-on-pinch="false"
      :min-zoom="0.2"
      :max-zoom="2"
      edges-updatable
      fit-view-on-init
      @pane-context-menu="onPaneContextMenu"
      class="h-full"
    >
      <Background :gap="20" :size="1.3" pattern-color="#6b6b6b" />
      <Controls position="bottom-left" />
      <MiniMap position="bottom-right" pannable zoomable :node-color="minimapColor" mask-color="rgb(0 0 0 / 0.45)" />
    </VueFlow>
  </div>
</template>
