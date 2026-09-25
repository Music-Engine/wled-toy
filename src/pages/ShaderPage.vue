<script setup lang="ts">
import { computed, inject, onActivated, onBeforeUnmount, onDeactivated, reactive, ref, watch } from 'vue'
import ShaderEditor from '@/components/editor/ShaderEditor.vue'
import NodeMenu from '@/features/graph-editor/node-menu/NodeMenu.vue'
import DockContribution from '@/features/shell/dock/DockContribution.vue'
import ProblemsList from '@/features/graph-editor/problems/ProblemsList.vue'
import ProblemStrip from '@/features/graph-editor/problems/ProblemStrip.vue'
import CommandScope from '@/features/commands/CommandScope.vue'
import DocumentDialogs from '@/features/documents/DocumentDialogs.vue'
import { config } from '@/lib/app/config'
import { graphCodeNotice } from '@/lib/shader/shader-export'
import { SHADER_FILES, createBrowserBackend } from '@/lib/documents/documents'
import { log } from '@/lib/app/logs'
import { useEngine } from '@/lib/engine/engine'
import type { ShaderNode } from '@/lib/shader/glsl'
import { createShaderDocument, shaderFileBackendKey } from '@/lib/shader/shader-document'
import { SHADER_FS, describeShaderNode } from '@/lib/shader/shader-menu'
import { EXAMPLES, type ShaderExample } from '@/lib/shader/examples'
import type { Problem } from '@/lib/app/workspace'

const engine = useEngine()
const compileError = engine.compileError
const editor = ref<InstanceType<typeof ShaderEditor>>()
const active = ref(false)
const nodeMenu = reactive({ open: false, position: null as { x: number; y: number } | null })
let compileTimer: ReturnType<typeof setTimeout> | undefined

// same info log pattern the editor's diagnostics read (toDiagnostics)
const compileProblems = computed<Problem[]>(() => {
  const error = compileError.value
  if (!error) return []
  const found = [...error.matchAll(/ERROR:\s*\d+:(\d+):\s*(.*)/g)].map((m) => ({ message: m[2].trim(), location: `line ${m[1]}`, line: Number(m[1]) }))
  return found.length ? found : [{ message: error.trim() }]
})

function compile() {
  clearTimeout(compileTimer)
  engine.compile(config.code, 'shader')
}

// a new, opened, reverted or recovered shader shows at once instead of after the typing pause
const shaderDocument = createShaderDocument({ backend: inject(shaderFileBackendKey, () => createBrowserBackend(SHADER_FILES), true), onLoad: () => active.value && compile() })

const problems = computed<Problem[]>(() => [...(shaderDocument.error.value ? [{ message: shaderDocument.error.value }] : []), ...compileProblems.value])

function loadExample(example: ShaderExample) {
  config.code = example.code
  compile()
  log(`Loaded example: ${example.name} (Cmd+Z in the editor restores your previous shader)`)
}

const exampleItems = EXAMPLES.map((example) => ({
  label: example.name,
  description: example.description,
  icon: example.icon,
  onSelect: () => loadExample(example),
}))

function openNodeMenu(position: { x: number; y: number } | null) {
  nodeMenu.position = position
  nodeMenu.open = true
}

function insertNode(node: ShaderNode) {
  editor.value?.insertSnippet(node.snippet)
  log(`Added node: ${node.title}`)
}

watch(() => config.code, () => {
  if (!active.value) return
  clearTimeout(compileTimer)
  compileTimer = setTimeout(compile, 700)
})

onActivated(() => {
  active.value = true
  compile()
})

onDeactivated(() => {
  active.value = false
  clearTimeout(compileTimer)
})

onBeforeUnmount(() => clearTimeout(compileTimer))
</script>

<template>
  <div class="h-full min-h-0">
    <section class="flex h-full min-h-0 flex-col">
      <div class="flex h-(--app-header-h) shrink-0 items-center gap-1 overflow-hidden border-b border-(--app-hairline) bg-(--app-chrome) px-2">
        <UTooltip text="Compile shader" :kbds="['meta', 'enter']">
          <UButton label="Compile" size="xs" @click="compile" />
        </UTooltip>
        <UTooltip text="Add shader node" :kbds="['meta', 'shift', 'a']">
          <UButton color="neutral" variant="ghost" label="Add node" size="xs" @click="openNodeMenu(null)" />
        </UTooltip>
        <UDropdownMenu :items="exampleItems" :content="{ align: 'start' }" :ui="{ content: 'w-80 max-h-[70vh]' }">
          <UButton trailing-icon="i-lucide-chevron-down" color="neutral" variant="ghost" label="Examples" size="xs" />
        </UDropdownMenu>
      </div>
      <ShaderEditor
        ref="editor"
        v-model="config.code"
        :error="compileError"
        class="min-h-0 flex-1"
        @compile="compile"
        @add-node="openNodeMenu"
      />
      <div v-if="graphCodeNotice" class="graph-code-notice flex shrink-0 items-start gap-2 border-t border-(--app-hairline) bg-warning/10 px-3 py-1.5 text-[12px] leading-[1.45] text-default" role="status">
        <span class="min-w-0 flex-1 select-text">{{ graphCodeNotice }}</span>
        <button type="button" class="app-button shrink-0" @click="graphCodeNotice = null">Dismiss</button>
      </div>
      <ProblemStrip :problems="problems" @goto="editor?.revealLine($event)" />
    </section>

    <DockContribution tab="problems">
      <ProblemsList :problems="problems" @goto="editor?.revealLine($event)" />
    </DockContribution>

    <NodeMenu v-model:open="nodeMenu.open" :position="nodeMenu.position" :fs="SHADER_FS" :describe="describeShaderNode" @select="insertNode" />
    <DocumentDialogs :document="shaderDocument" />
    <CommandScope
      :handlers="{
        'shader.compile': compile,
        'shader.addFunction': () => openNodeMenu(null),
        'shader.selectAll': () => editor?.selectAll(),
        'shader.undo': () => editor?.undo(),
        'shader.redo': () => editor?.redo(),
        'file.new': shaderDocument.newDocument,
        'file.open': shaderDocument.open,
        'file.save': shaderDocument.save,
        'file.saveAs': shaderDocument.saveAs,
        'file.revert': shaderDocument.revert,
      }"
    />
  </div>
</template>
