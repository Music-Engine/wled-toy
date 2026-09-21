<script setup lang="ts">
import { computed, inject, nextTick, reactive, watch } from 'vue'
import { useVueFlow, type NodeProps } from '@vue-flow/core'
import NodeShell from './ui/NodeShell.vue'
import Socket from './ui/Socket.vue'
import { handlerFor, nodeBodies, type TypeHandler } from './handlers'
import { categoryById } from '@/lib/shader/glsl'
import { connectedHandlesKey, graphIssuesKey } from './graph-context'
import { isImplicit, isStructType, itemFor, linkTypeOf, rateOf, type GraphNodeData, type InputSocket, type SocketValue } from '@/lib/graph'

const props = defineProps<NodeProps<GraphNodeData>>()
const { edges, updateNodeData, updateNodeInternals } = useVueFlow()
const graphIssues = inject(graphIssuesKey, null)
const connectedHandles = inject(connectedHandlesKey, null)

const kind = computed(() => itemFor(props.data.kind))
// the node's sockets and code follow its values (a Math node changes with its operation)
const item = computed(() => kind.value?.shape(props.data.values))
// control-rate sockets are diamonds, like Blender's per-object (not per-point) fields
const shape = computed(() => (item.value && rateOf(item.value) === 'control' ? 'diamond' : 'circle'))
// so are streams: they are settled before a single pixel is drawn
const shapeOf = (type: { id: string }) => (shape.value === 'diamond' || isStructType(type as never) ? 'diamond' : 'circle')
const NO_LINKS: ReadonlySet<string> = new Set()
// the page computes this once per edge change; without it (a node mounted on its own) fall back to the edge array
const connected = computed<ReadonlySet<string>>(() => connectedHandles
  ? connectedHandles.value.get(props.id) ?? NO_LINKS
  : new Set(edges.value.filter((e) => e.target === props.id).map((e) => e.targetHandle!)))

const invalidFields = reactive(new Set<string>())
// the page rebuilds its issue map on every compile; reading this node's entry first keeps a node without issues
// from re-rendering, because undefined is unchanged and the computed below is never invalidated
const issues = computed(() => graphIssues?.value.get(props.id))
const warnings = computed(() => [
  ...(issues.value ?? []),
  ...[...invalidFields].map((field) => `${field} is not a number; the last valid value is used`),
])

interface Row {
  socket: InputSocket
  connected: boolean
  /** Label of the implicit expression an unlinked socket evaluates to, when it has no literal to edit. */
  implicit: string
  /** Set while the socket shows a widget: unlinked, with a literal to edit. */
  handler?: TypeHandler
  widgetProps: Record<string, unknown>
}

const rows = computed<Row[]>(() => (item.value?.inputs ?? []).map((socket) => {
  const isConnected = socket.connectable && connected.value.has(socket.name)
  const stored = props.data.values[socket.name]
  // a stream socket has nothing to edit; unlinked, it says what it listens to instead
  const implicit = isStructType(socket.type) ? socket.type.unlinked : stored === undefined && isImplicit(socket.default) ? socket.default.label : ''
  const value = stored ?? socket.default
  const handler = isConnected || implicit ? undefined : handlerFor(socket, value)
  return {
    socket, implicit, handler,
    connected: isConnected,
    widgetProps: { ...socket.type.props, ...(typeof socket.props === 'function' ? socket.props(props.data.values) : socket.props), modelValue: value, ...(handler?.layout === 'inline' && { label: socket.label }) },
  }
}))

const collapsed = computed({
  get: () => props.data.collapsed ?? false,
  set: (value) => updateNodeData<GraphNodeData>(props.id, { collapsed: value }),
})
// Vue Flow caches socket positions; they all move when the rows disappear
watch(collapsed, () => nextTick(() => updateNodeInternals([props.id])))

function setValue(name: string, value: SocketValue) {
  updateNodeData<GraphNodeData>(props.id, { values: { ...props.data.values, [name]: value } })
}

function markInvalid(socket: InputSocket, invalid: boolean) {
  const field = socket.label || socket.type.label
  if (invalid) invalidFields.add(field)
  else invalidFields.delete(field)
}
</script>

<template>
  <NodeShell
    v-if="item"
    v-model:collapsed="collapsed"
    :title="item.title"
    :color="categoryById.get(kind!.category)?.color ?? '#545454'"
    :selected="selected"
    :warnings="warnings"
    :source="!item.inputs.some((s) => s.connectable)"
    :wide="item.inputs.some((s) => s.type.id === 'ramp') || data.kind in nodeBodies"
  >
    <template #folded-in>
      <Socket v-for="socket in item.inputs.filter((s) => s.connectable)" :id="socket.name" :key="socket.name" side="in" :color="linkTypeOf(socket)!.color" :shape="shapeOf(socket.type)" />
    </template>
    <template #folded-out>
      <Socket v-for="out in item.outputs" :id="out.name" :key="out.name" side="out" :color="out.type.color" :shape="shapeOf(out.type)" />
    </template>

    <component :is="nodeBodies[data.kind]" v-if="nodeBodies[data.kind]" :node-id="id" :values="data.values" @update="updateNodeData<GraphNodeData>(id, { values: { ...data.values, ...$event } })" />

    <div v-for="out in item.outputs" :key="out.name" class="nui-row is-output">
      <span class="nui-label">{{ out.label }}</span>
      <Socket :id="out.name" side="out" :color="out.type.color" :shape="shapeOf(out.type)" />
    </div>

    <template v-for="row in rows" :key="row.socket.name">
      <div v-if="row.socket.connectable || row.socket.label || row.handler?.layout === 'inline'" class="nui-row">
        <Socket v-if="row.socket.connectable" :id="row.socket.name" side="in" :color="linkTypeOf(row.socket)!.color" :shape="shapeOf(row.socket.type)" />
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
