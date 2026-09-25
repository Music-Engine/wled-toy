<script setup lang="ts">
import { computed } from 'vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import type { DocumentSession, PromptChoice } from '@/lib/documents/document-session'

const props = defineProps<{ document: DocumentSession<unknown> }>()

const prompt = computed(() => props.document.prompt.value)

const text = computed<{ title: string; description: string; buttons: [PromptChoice, string][] }>(() => {
  const name = props.document.name.value
  const noun = props.document.noun
  if (prompt.value?.kind === 'recovery') {
    return {
      title: `Recover unsaved ${noun}?`,
      description: `The last session ended with unsaved changes. Recover them, or discard them and start a new ${noun}.`,
      buttons: [['recover', 'Recover'], ['discard', 'Discard']],
    }
  }
  if (prompt.value?.kind === 'revert') {
    return { title: `Revert ${name}?`, description: 'Every change since the last save is discarded.', buttons: [['discard', 'Revert'], ['cancel', 'Cancel']] }
  }
  return { title: `Save changes to ${name}?`, description: 'Your changes are lost if you do not save them.', buttons: [['save', 'Save'], ['discard', 'Discard'], ['cancel', 'Cancel']] }
})

// Escape and a click outside mean Cancel; the recovery question has no Cancel, so there they do nothing
function onDismiss(e: Event) {
  if (prompt.value?.kind === 'recovery') e.preventDefault()
}
</script>

<template>
  <DialogRoot :open="!!prompt" @update:open="(open) => !open && prompt?.answer('cancel')">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/30" />
      <DialogContent
        :class="`${document.noun}-document-dialog`"
        class="document-dialog fixed left-1/2 top-[22%] z-50 flex w-[min(420px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-2 rounded-[8px] border border-(--app-hairline) bg-(--app-floating) p-4 text-[13px] text-default shadow-2xl outline-none"
        @escape-key-down="onDismiss"
        @interact-outside="onDismiss"
      >
        <DialogTitle class="font-medium text-highlighted">{{ text.title }}</DialogTitle>
        <DialogDescription class="text-muted">{{ text.description }}</DialogDescription>
        <div class="mt-2 flex justify-end gap-2">
          <button
            v-for="([choice, label], i) in text.buttons"
            :key="choice"
            type="button"
            class="h-7 rounded-[4px] px-3"
            :class="i === 0 ? 'bg-primary font-medium text-inverted' : 'border border-accented hover:bg-(--app-hover)'"
            :data-choice="choice"
            @click="prompt?.answer(choice)"
          >
            {{ label }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
