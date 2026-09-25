<script setup lang="ts">
import { computed, inject, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import GlslCode from '@/components/editor/GlslCode.vue'
import ParametersPanel from '@/components/graph/ParametersPanel.vue'
import { socketColor } from '@/components/graph/sockets'
import CommandScope from '@/components/shell/CommandScope.vue'
import DockContribution from '@/components/shell/DockContribution.vue'
import { copyText } from '@/lib/app/clipboard'
import { config } from '@/lib/app/config'
import { log } from '@/lib/app/logs'
import { dockHost } from '@/lib/app/workspace'
import { createBrowserBackend } from '@/lib/documents/documents'
import { createGraphSession } from '@/lib/documents/graph-session'
import { useEngine } from '@/lib/engine/engine'
import { describeNodeItem, generateGlsl, type NodeItem } from '@/lib/graph'
import { createGraphDocument, graphFileBackendKey, type GraphSession } from '@/lib/graph/model/document'
import { frozenNotice } from '@/lib/shader/shader-export'
import type { MenuPreset } from '@/lib/shader/menu-fs'
import GraphCanvas from './canvas/GraphCanvas.vue'
import { selectNodes } from './canvas/use-box-select'
import { deleteSelection, useNodeClipboard } from './clipboard/use-node-clipboard'
import NodeMenu from './node-menu/NodeMenu.vue'
import { useAddNode } from './node-menu/use-add-node'
import ProblemStrip from './problems/ProblemStrip.vue'
import ProblemsList from './problems/ProblemsList.vue'
import { useProblems } from './problems/use-problems'

const emit = defineEmits<{ sendToShader: [code: string, notice: string | null] }>()

const FLOW_ID = 'wledtoy-graph'
const engine = useEngine()
const flow = useVueFlow(FLOW_ID)
const canvas = ref<InstanceType<typeof GraphCanvas>>()

const session = createGraphSession({
  workingCopy: config,
  storeEdges: () => flow.edges.value,
  colorOf: socketColor,
  target: {
    plan(shader) {
      engine.setControlPlan(shader.frame)
      engine.setOutput(shader.output)
    },
    compile: (code) => (engine.compile(code, 'graph') ? null : engine.compileError.value),
  },
})

// The file is what Save wrote last; config.graph stays the working copy that every edit lands in. A loaded file replaces
// the graph like another tab's save does, and the session then writes it into the working copy.
const graphDocument = shallowRef<GraphSession>()
const fileBackend = inject(graphFileBackendKey, createBrowserBackend, true)

const problems = useProblems(session, computed(() => graphDocument.value?.error.value))
const { menu, menuFs, openMenu, addNode } = useAddNode(flow, session, () => canvas.value?.rect())
const clipboard = useNodeClipboard(flow, session, () => canvas.value?.pointerAt() ?? null, () => menu.open)

// after mount, because the first snapshot is what "unedited" means and Vue Flow's store has no edges before that
onMounted(() => {
  graphDocument.value = createGraphDocument({
    backend: fileBackend,
    getSnapshot: session.snapshot,
    onLoad(doc) {
      session.load(doc)
      nextTick(() => flow.fitView({ padding: 0.2 }))
    },
  })
  session.resetHistory()
})

window.addEventListener('pagehide', session.flush)
onActivated(session.start)
onDeactivated(session.stop)
onBeforeUnmount(() => {
  session.stop()
  window.removeEventListener('pagehide', session.flush)
})

const fitView = () => flow.fitView({ padding: 0.2, duration: 300 })
const focusNode = (id: string) => flow.fitView({ nodes: [id], padding: 1.5, maxZoom: 1.2, duration: 300 })

// shader mode and a pasted shader have no control plan feeding iControl, so the knob values are written into the code
function standaloneGlsl() {
  const shader = generateGlsl(session.snapshot(), { standalone: true, controls: (nodeId, output) => engine.controlOutput(nodeId, output) })
  const notice = frozenNotice(shader.frozen)
  if (notice) log(notice, 'warn')
  return { code: shader.code, notice }
}

function sendToShader() {
  const { code, notice } = standaloneGlsl()
  emit('sendToShader', code, notice)
}

const copyGlsl = () => copyText(standaloneGlsl().code)
</script>

<template>
  <div class="h-full min-h-0">
    <section class="flex h-full min-h-0 flex-col">
      <div class="flex h-(--app-header-h) shrink-0 items-center gap-1 overflow-hidden border-b border-(--app-hairline) bg-(--app-chrome) px-2">
        <UTooltip text="Add node" :kbds="['shift', 'a']">
          <UButton label="Add node" size="xs" @click="openMenu(null)" />
        </UTooltip>
        <UButton color="neutral" variant="ghost" label="Fit view" size="xs" @click="fitView" />
        <UButton color="neutral" variant="ghost" label="Send to shader mode" size="xs" @click="sendToShader" />
      </div>
      <GraphCanvas ref="canvas" :flow-id="FLOW_ID" :session="session" @offer-nodes="openMenu" />
      <ProblemStrip :problems="problems" @reveal="focusNode" />
    </section>

    <DockContribution tab="parameters">
      <ParametersPanel v-model:scenes="session.scenes.value" :flow-id="FLOW_ID" />
    </DockContribution>
    <DockContribution tab="problems">
      <ProblemsList :problems="problems" @reveal="focusNode" />
    </DockContribution>
    <DockContribution tab="glsl">
      <GlslCode :code="session.generated.value.code" class="block px-2.5 py-2 text-[12.5px] leading-relaxed" />
    </DockContribution>
    <Teleport :to="dockHost('glsl', 'actions')">
      <button type="button" class="app-button" @click="copyGlsl">Copy</button>
      <button type="button" class="app-button ms-1" @click="sendToShader">Send to Shader Mode</button>
    </Teleport>

    <NodeMenu v-model:open="menu.open" :position="menu.position" :fs="menuFs" :describe="(item: NodeItem, preset?: MenuPreset) => describeNodeItem(item, preset, socketColor)" @select="addNode" />
    <CommandScope
      :handlers="{
        'graph.addNode': () => openMenu(canvas?.pointerAt() ?? null),
        'graph.searchNodes': () => openMenu(null),
        'graph.fitView': fitView,
        'graph.sendToShader': sendToShader,
        'graph.copyGlsl': copyGlsl,
        'graph.copy': () => clipboard.command('copy'),
        'graph.cut': () => clipboard.command('cut'),
        'graph.paste': () => clipboard.command('paste'),
        'graph.delete': () => deleteSelection(flow),
        'graph.selectAll': () => selectNodes(flow, new Set(flow.getNodes.value.map((n) => n.id))),
        'graph.deselectAll': flow.removeSelectedElements,
        'graph.undo': () => session.travel('undo'),
        'graph.redo': () => session.travel('redo'),
      }"
    />
  </div>
</template>
