<script setup lang="ts">
import { computed, inject, reactive } from 'vue'
import { useVueFlow, type NodeProps } from '@vue-flow/core'
import NodeShell from './NodeShell.vue'
import Socket from './Socket.vue'
import { handlerFor, nodeBodies, type TypeHandler } from './handlers'
import { categoryById } from '@/lib/shader/glsl'
import { connectedHandlesKey, graphIssuesKey, outputHandle, renamingNodeKey } from './graph-context'
import { socketColor, unlinkedStream } from './sockets'
import { useNodeCollapse } from './use-node-collapse'
import './node.css'
import { isImplicit, nodeItem, placement, type DataType, type GraphNodeData, type Socket as NodeSocket, type SocketValue } from '@/lib/graph'

const props = defineProps<NodeProps<GraphNodeData>>()
const { edges, updateNodeData } = useVueFlow()
const graphIssues = inject(graphIssuesKey, null)
const connectedHandles = inject(connectedHandlesKey, null)
const renaming = inject(renamingNodeKey, null)

const kind = computed(() => nodeItem(props.data.kind))
// the node's sockets and code follow its values (a Math node changes with its operation)
const item = computed(() => kind.value?.shape(props.data.values))
// per-frame sockets are diamonds, like Blender's per-object (not per-point) fields
const shape = computed(() => (item.value && placement(item.value) === 'frame' ? 'diamond' : 'circle'))
// so are streams: they are settled before a single pixel is drawn
const storedShape = (type: DataType<any>) => (shape.value === 'diamond' || type.kind === 'stream' ? 'diamond' : 'circle')
const NO_LINKS: ReadonlySet<string> = new Set()
// the page computes this once per edge change; without it (a node mounted on its own) fall back to the edge array
const connected = computed<ReadonlySet<string>>(() => connectedHandles
  ? connectedHandles.value.get(props.id) ?? NO_LINKS
  : new Set(edges.value.flatMap((e) => [
    ...(e.target === props.id ? [e.targetHandle!] : []),
    ...(e.source === props.id ? [outputHandle(e.sourceHandle!)] : []),
  ])))

const invalidFields = reactive(new Set<string>())
// the page rebuilds its issue map on every compile; reading this node's entry first keeps a node without issues
// from re-rendering, because undefined is unchanged and the computed below is never invalidated
const issues = computed(() => graphIssues?.value.get(props.id))
const warnings = computed(() => [
  ...(issues.value ?? []),
  ...[...invalidFields].map((field) => `${field} is not a number; the last valid value is used`),
])

interface Row {
  socket: NodeSocket
  connected: boolean
  /** Label of the implicit expression an unlinked socket evaluates to, when it has no literal to edit. */
  implicit: string
  /** Set while the socket shows a widget: unlinked, with a literal to edit. */
  handler?: TypeHandler
  widgetProps: Record<string, unknown>
}

const rows = computed<Row[]>(() => (item.value?.inputs ?? []).map((socket) => {
  const isConnected = socket.linkable && connected.value.has(socket.name)
  const stored = props.data.values[socket.name]
  // a stream socket has nothing to edit; unlinked, it says what it listens to instead
  const implicit = socket.type.kind === 'stream' ? unlinkedStream(socket.type) : stored === undefined && isImplicit(socket.default) ? socket.default.label : ''
  const value = stored ?? socket.default
  const handler = isConnected || implicit ? undefined : handlerFor(socket, value)
  return {
    socket, implicit, handler,
    connected: isConnected,
    widgetProps: { ...socket.type.props, ...(typeof socket.props === 'function' ? socket.props(props.data.values) : socket.props), modelValue: value, ...(handler?.layout === 'inline' && { label: socket.label }) },
  }
}).filter((row) => !props.data.hideUnused || !row.socket.linkable || row.connected))

const outputs = computed(() => (item.value?.outputs ?? []).filter((out) => !props.data.hideUnused || connected.value.has(outputHandle(out.name))))

const { collapsed, toggle } = useNodeCollapse(props)

function rename(title: string | null) {
  // Enter or Escape ends the edit, and the input's blur on its way out must not end it again
  if (renaming?.value !== props.id) return
  renaming.value = null
  const label = title?.trim()
  if (title !== null) updateNodeData<GraphNodeData>(props.id, { label: label && label !== item.value?.title ? label : undefined })
}

function setValue(name: string, value: SocketValue) {
  updateNodeData<GraphNodeData>(props.id, { values: { ...props.data.values, [name]: value } })
}

function markInvalid(socket: NodeSocket, invalid: boolean) {
  const field = socket.label || socket.type.label
  if (invalid) invalidFields.add(field)
  else invalidFields.delete(field)
}
</script>

<template>
  <NodeShell
    v-if="item"
    :collapsed="collapsed"
    :title="data.label || item.title"
    :color="categoryById.get(kind!.category)?.color ?? '#545454'"
    :selected="selected"
    :warnings="warnings"
    :source="!item.inputs.some((s) => s.linkable)"
    :wide="item.inputs.some((s) => s.type.id === 'ramp') || data.kind in nodeBodies"
    :muted="data.muted"
    :renaming="renaming === id"
    @toggle="toggle"
    @rename="rename"
  >
    <template #folded-in>
      <Socket v-for="{ socket } in rows.filter((r) => r.socket.linkable)" :id="socket.name" :key="socket.name" side="in" :color="socketColor(socket.type)" :shape="storedShape(socket.type)" />
    </template>
    <template #folded-out>
      <Socket v-for="out in outputs" :id="out.name" :key="out.name" side="out" :color="socketColor(out.type)" :shape="storedShape(out.type)" />
    </template>

    <component :is="nodeBodies[data.kind]" v-if="nodeBodies[data.kind]" :node-id="id" :values="data.values" @update="updateNodeData<GraphNodeData>(id, { values: { ...data.values, ...$event } })" />

    <div v-for="out in outputs" :key="out.name" class="nui-row is-output">
      <span class="nui-label">{{ out.label }}</span>
      <Socket :id="out.name" side="out" :color="socketColor(out.type)" :shape="storedShape(out.type)" />
    </div>

    <template v-for="row in rows" :key="row.socket.name">
      <div v-if="row.socket.linkable || row.socket.label || row.handler?.layout === 'inline'" class="nui-row">
        <Socket v-if="row.socket.linkable" :id="row.socket.name" side="in" :color="socketColor(row.socket.type)" :shape="storedShape(row.socket.type)" />
        <component
          :is="row.handler.component"
          v-if="row.handler?.layout === 'inline'"
          v-bind="row.widgetProps"
          @update:model-value="setValue(row.socket.name, $event)"
          @invalid="markInvalid(row.socket, $event)"
        />
        <template v-else>
          <span class="nui-label">{{ row.socket.label }}</span>
          <span v-if="row.implicit" class="nui-implicit">{{ row.implicit }}</span>
        </template>
      </div>
      <div v-if="row.handler?.layout === 'block'" class="nui-block">
        <component
          :is="row.handler.component"
          v-bind="row.widgetProps"
          @update:model-value="setValue(row.socket.name, $event)"
          @invalid="markInvalid(row.socket, $event)"
        />
      </div>
    </template>
  </NodeShell>
</template>
