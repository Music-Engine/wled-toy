<script setup lang="ts">
import { markRaw, ref } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import GraphNode from '@/features/node-ui/GraphNode.vue'
import { GRAPH_NODE_TYPE } from '@/lib/graph'
import { galleryNodes } from './nodes'

const nodes = ref(galleryNodes())
const nodeTypes = { [GRAPH_NODE_TYPE]: markRaw(GraphNode) }
const { onNodesInitialized, getNodes, updateNode } = useVueFlow('node-gallery')
const laidOut = ref(false)

// node sizes are only known once mounted, so the grid is packed afterwards: each kind goes to the shortest column, its collapsed twin under it
onNodesInitialized(() => {
  if (laidOut.value) return
  const columns = Array.from({ length: 8 }, () => 0)
  const byId = new Map(getNodes.value.map((n) => [n.id, n]))
  for (const node of getNodes.value) {
    if (node.id.endsWith('~collapsed')) continue
    const column = columns.indexOf(Math.min(...columns))
    const twin = byId.get(`${node.id}~collapsed`)!
    updateNode(node.id, { position: { x: column * 320, y: columns[column] } })
    updateNode(twin.id, { position: { x: column * 320, y: columns[column] + node.dimensions.height + 12 } })
    columns[column] += node.dimensions.height + twin.dimensions.height + 48
  }
  laidOut.value = true
})
</script>

<template>
  <VueFlow
    id="node-gallery"
    v-model:nodes="nodes"
    :node-types="nodeTypes"
    :min-zoom="0.1"
    :max-zoom="4"
    :default-viewport="{ x: 24, y: 24, zoom: 1 }"
    class="node-gallery"
    :data-laid-out="laidOut"
  />
</template>

<style>
.node-gallery { width: 100%; height: 100%; background: #1d1d1d; }
</style>
