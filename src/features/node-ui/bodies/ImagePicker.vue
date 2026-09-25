<script setup lang="ts">
import { computed } from 'vue'
import FileSelector from '@/features/node-ui/fields/FileSelector.vue'
import { useEngine } from '@/lib/engine/engine'
import { BUILT_IN_IMAGE } from '@/lib/engine/images'
import { report } from '@/lib/app/logs'
import type { SocketValue } from '@/lib/graph'
import '@/features/node-ui/node.css'

const props = defineProps<{ nodeId: string; values: Record<string, SocketValue> }>()
const emit = defineEmits<{ update: [patch: Record<string, SocketValue>] }>()

const { images } = useEngine()
const files = computed(() => images.images.map((image) => ({ id: image.id, name: image.name, thumbnailUrl: image.url, fixed: !image.blob })))
// a node that never chose shows the built-in image, and says so
const current = computed(() => (images.get(String(props.values.filename ?? '')) ? String(props.values.filename || BUILT_IN_IMAGE) : null))

async function onUpload(file: File) {
  emit('update', { filename: (await images.add(file, file.name)).id })
}

async function onLink(url: string) {
  try {
    emit('update', { filename: (await images.addFromUrl(url)).id })
  } catch (e) {
    report(e, 'Could not load that image')
  }
}
</script>

<template>
  <div class="nui-block">
    <FileSelector
      :model-value="current"
      :files="files"
      label="Image"
      accept="image/*"
      linkable
      @update:model-value="emit('update', { filename: $event ?? '' })"
      @upload="onUpload"
      @link="onLink"
      @rename="(id, name) => images.rename(id, name)"
    />
  </div>
</template>
