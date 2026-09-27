import { computed, nextTick, watch } from 'vue'
import { useVueFlow, type NodeProps } from '@vue-flow/core'
import type { GraphNodeData } from '@/lib/graph'

/** Whether a node shows only its header, stored in the node's data so it saves with the graph, and the toggle for it. */
export function useNodeCollapse(props: NodeProps<GraphNodeData>) {
  const { updateNodeData, updateNodeInternals } = useVueFlow()
  const collapsed = computed(() => props.data.collapsed ?? false)
  // Vue Flow caches socket positions; they all move when the rows disappear, folded or hidden as unused
  watch([collapsed, () => props.data.hideUnused], () => nextTick(() => updateNodeInternals([props.id])))
  const toggle = () => updateNodeData<GraphNodeData>(props.id, { collapsed: !collapsed.value })
  return { collapsed, toggle }
}
