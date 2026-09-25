<script setup lang="ts">
import { useRouter } from 'vue-router'
import GraphDocumentDialogs from '@/components/graph/GraphDocumentDialogs.vue'
import CommandScope from '@/components/shell/CommandScope.vue'
import GraphEditor from '@/features/graph-editor/GraphEditor.vue'
import { config } from '@/lib/app/config'
import { log } from '@/lib/app/logs'
import { activeGraphDocument } from '@/lib/graph/model/document'
import { graphCodeNotice } from '@/lib/shader/shader-export'

const router = useRouter()

function sendToShader(code: string, notice: string | null) {
  config.code = code
  graphCodeNotice.value = notice
  log('Graph code sent to shader mode; Cmd+Z in the editor restores the previous shader')
  router.push('/')
}
</script>

<template>
  <GraphEditor @send-to-shader="sendToShader" />
  <GraphDocumentDialogs v-if="activeGraphDocument" :document="activeGraphDocument" />
  <CommandScope
    :handlers="{
      'file.new': () => activeGraphDocument?.newGraph(),
      'file.open': () => activeGraphDocument?.open(),
      'file.save': () => activeGraphDocument?.save(),
      'file.saveAs': () => activeGraphDocument?.saveAs(),
      'file.revert': () => activeGraphDocument?.revert(),
    }"
  />
</template>
