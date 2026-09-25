<script setup lang="ts">
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { useEngine } from '@/lib/engine/engine'

const audio = useEngine().audio
</script>

<template>
  <DialogRoot :open="audio.state.sharePrompt" @update:open="audio.state.sharePrompt = $event">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/40" />
      <DialogContent
        class="share-audio-prompt fixed left-1/2 top-1/3 z-50 w-[min(400px,calc(100vw-40px))] -translate-x-1/2 rounded-[8px] border border-(--ui-border-accented) bg-(--app-floating) p-5 text-[13px] leading-[1.5] text-default shadow-2xl outline-none"
      >
        <DialogTitle class="text-[14px] font-semibold text-highlighted">Share system audio</DialogTitle>
        <DialogDescription class="mt-1 text-muted">
          The browser opens its share dialog only from a click. In that dialog, pick what plays the sound and tick the option to share its audio.
        </DialogDescription>
        <div class="mt-4 flex justify-end gap-1.5">
          <button type="button" class="app-button" data-action="cancel" @click="audio.state.sharePrompt = false">Cancel</button>
          <!-- shareSystemAudio asks for the picker before it awaits anything: the click has to be the request's own gesture -->
          <button type="button" class="app-button bg-primary text-inverted" data-action="share" @click="audio.shareSystemAudio()">Share Audio...</button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
