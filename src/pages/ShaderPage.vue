<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import ShaderEditor from '@/features/shader-editor/ShaderEditor.vue'
import { useShaderSession } from '@/features/shader-editor/use-shader-session'
import NodeMenu from '@/features/graph-editor/node-menu/NodeMenu.vue'
import DockContribution from '@/features/shell/dock/DockContribution.vue'
import ProblemsList from '@/features/graph-editor/problems/ProblemsList.vue'
import ProblemStrip from '@/features/graph-editor/problems/ProblemStrip.vue'
import CommandScope from '@/features/commands/CommandScope.vue'
import DocumentDialogs from '@/features/documents/DocumentDialogs.vue'
import { config } from '@/lib/app/config'
import { graphCodeNotice } from '@/lib/shader/shader-export'
import { SHADER_FILES, createBrowserBackend } from '@/lib/documents/documents'
import { useEngine } from '@/lib/engine/engine'
import { parseGlslErrors } from '@/lib/shader/glsl-language'
import { createShaderDocument, shaderFileBackendKey } from '@/lib/shader/shader-document'
import { SHADER_FS, describeShaderNode } from '@/lib/shader/shader-menu'
import type { Problem } from '@/lib/app/workspace'

const compileError = useEngine().compileError
const editor = ref<InstanceType<typeof ShaderEditor>>()
const { compile, compileIfShown, exampleItems, nodeMenu, openNodeMenu, insertNode } = useShaderSession(editor)
const shaderDocument = createShaderDocument({ backend: inject(shaderFileBackendKey, () => createBrowserBackend(SHADER_FILES), true), onLoad: compileIfShown })

const compileProblems = computed<Problem[]>(() => {
  const error = compileError.value
  if (!error) return []
  const found = parseGlslErrors(error).map(({ line, message }) => ({ message, location: `line ${line}`, line }))
  return found.length ? found : [{ message: error.trim() }]
})

const problems = computed<Problem[]>(() => [...(shaderDocument.error.value ? [{ message: shaderDocument.error.value }] : []), ...compileProblems.value])
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
