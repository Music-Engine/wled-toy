<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle,
  ListboxContent, ListboxFilter, ListboxItem, ListboxRoot, VisuallyHidden,
} from 'reka-ui'

const props = defineProps<{ nodes: { id: string; title: string }[] }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ select: [id: string] }>()

const query = ref('')
const list = ref<{ highlightFirstItem: () => void }>()

const rows = computed(() => {
  const words = query.value.toLowerCase().split(/\s+/).filter(Boolean)
  return props.nodes.filter((node) => words.every((word) => `${node.title} ${node.id}`.toLowerCase().includes(word)))
})

watch(open, () => { query.value = '' })
watch(rows, () => void nextTick(() => list.value?.highlightFirstItem()))

function select(id: string) {
  open.value = false
  emit('select', id)
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/30" />
      <DialogContent class="node-find fixed left-1/2 top-[14%] z-50 flex max-h-[60vh] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-[8px] border border-(--app-hairline) bg-(--app-floating) text-[13px] text-default shadow-2xl outline-none">
        <VisuallyHidden>
          <DialogTitle>Find Node</DialogTitle>
          <DialogDescription>Type to filter, Enter to show the node</DialogDescription>
        </VisuallyHidden>
        <ListboxRoot ref="list" class="flex min-h-0 flex-col" highlight-on-hover>
          <ListboxFilter v-model="query" auto-focus class="h-10 shrink-0 border-b border-(--app-hairline) bg-transparent px-3 outline-none placeholder:text-dimmed" placeholder="Find a node" aria-label="Find Node" />
          <ListboxContent class="min-h-0 overflow-y-auto p-1">
            <ListboxItem
              v-for="node in rows"
              :key="node.id"
              :value="node.id"
              :data-node="node.id"
              class="flex h-7 cursor-default items-center gap-2 rounded-[4px] px-2 outline-none data-[highlighted]:bg-primary data-[highlighted]:text-inverted"
              @select="select(node.id)"
            >
              <span class="truncate">{{ node.title }}</span>
              <span class="ms-auto shrink-0 ps-4 text-muted">{{ node.id }}</span>
            </ListboxItem>
            <p v-if="!rows.length" class="px-2 py-3 text-muted">No matching nodes</p>
          </ListboxContent>
        </ListboxRoot>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
