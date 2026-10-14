<script setup lang="ts">
import { computed } from 'vue'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import AppMark from './AppMark.vue'
import { isTauri } from '@/lib/app/platform'
import { version } from '@/lib/app/version'

// a webview has no browser to hand a target=_blank link to
async function openInBrowser(e: MouseEvent) {
  if (!isTauri()) return
  e.preventDefault()
  // read now: currentTarget is gone once the handler yields
  const { href } = e.currentTarget as HTMLAnchorElement
  const { openUrl } = await import('@tauri-apps/plugin-opener')
  await openUrl(href)
}

const open = defineModel<boolean>('open', { required: true })

// asked for when the dialog opens, on a context of its own that is given back at once
const renderer = computed(() => {
  if (!open.value) return ''
  const gl = document.createElement('canvas').getContext('webgl2')
  if (!gl) return 'not available'
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return name
})
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/40" />
      <DialogContent
        class="about-dialog fixed left-1/2 top-1/2 z-50 w-[min(520px,calc(100vw-40px))] -translate-x-1/2 -translate-y-1/2 rounded-[8px] border border-(--ui-border-accented) bg-(--app-floating) p-5 text-[13px] leading-[1.5] text-default shadow-2xl outline-none"
      >
        <div class="flex items-center gap-3">
          <AppMark class="size-10" />
          <div>
            <DialogTitle class="text-[17px] font-semibold leading-tight text-highlighted">WLEDtoy</DialogTitle>
            <p class="text-[12px] text-muted" data-value="version">Version {{ version }}</p>
          </div>
        </div>

        <DialogDescription class="mt-4">A live shader and node-graph playground for addressable LEDs.</DialogDescription>
        <ul class="mt-2 list-disc ps-5 text-muted">
          <li>Write GLSL or build node graphs</li>
          <li>React to audio and MIDI</li>
          <li>Preview on a virtual strip or matrix</li>
          <li>Stream to WLED over DDP, DNRGB, Art-Net or sACN</li>
        </ul>

        <p class="mt-4">
          Developed by
          <a href="https://github.com/omargfh" target="_blank" rel="noopener noreferrer" class="text-primary underline underline-offset-2" @click="openInBrowser">@omargfh</a>
          <span class="select-text text-muted"> (github.com/omargfh)</span>
        </p>

        <dl class="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 border-t border-(--ui-border-accented) pt-3 text-[12px]">
          <dt class="text-muted">Runtime</dt>
          <dd data-value="runtime">{{ isTauri() ? 'Desktop app (Tauri)' : 'Browser' }}</dd>
          <dt class="text-muted">WebGL2</dt>
          <dd class="min-w-0 select-text truncate" data-value="renderer" :title="renderer">{{ renderer }}</dd>
        </dl>

        <div class="mt-4 flex justify-end">
          <DialogClose class="app-button">Close</DialogClose>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
