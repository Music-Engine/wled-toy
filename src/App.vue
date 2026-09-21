<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useElementSize } from '@vueuse/core'
import DockContribution from './components/shell/DockContribution.vue'
import DropOverlay from './components/shell/DropOverlay.vue'
import LedStrip from './components/panels/LedStrip.vue'
import LogPanel from './components/panels/LogPanel.vue'
import StatusBar from './components/shell/StatusBar.vue'
import AboutDialog from './components/shell/AboutDialog.vue'
import BottomPanel from './components/shell/BottomPanel.vue'
import CommandPalette from './components/shell/CommandPalette.vue'
import InputsInspector from './components/shell/InputsInspector.vue'
import LaunchScreen from './components/shell/LaunchScreen.vue'
import OutputInspector from './components/shell/OutputInspector.vue'
import PerformancePanel from './components/shell/PerformancePanel.vue'
import RightDock from './components/shell/RightDock.vue'
import SettingsView from './components/shell/SettingsView.vue'
import ShareAudioPrompt from './components/shell/ShareAudioPrompt.vue'
import SplitHandle from './components/shell/SplitHandle.vue'
import TitleBar from './components/shell/TitleBar.vue'
import { installKeyDispatcher, registerHandlers } from './lib/app/commands'
import { config } from './lib/app/config'
import { useEngine } from './lib/engine/engine'
import { isStripLayout } from './lib/engine/layout'
import { launchScreen, openSettings, preferences } from './lib/app/preferences'
import { DOCK_SIZES, workspace } from './lib/app/workspace'

const aboutOpen = ref(false)
launchScreen.open = preferences.showLaunchScreen
const engine = useEngine()
const { stats, history } = engine.bridge
const route = useRoute()
const router = useRouter()
const workbench = ref<HTMLElement>()
const { width, height } = useElementSize(workbench)

watchEffect(() => {
  workspace.mode = route.name === 'graph' ? 'graph' : route.name === 'reference' ? 'reference' : 'shader'
})

// the editor column keeps 480px; a window too narrow for that and the smallest dock goes without the dock
const dockMax = computed(() => Math.min(DOCK_SIZES.right.max, width.value - 480))
const dockShown = computed(() => workspace.dockVisible && dockMax.value >= DOCK_SIZES.right.min)
const bottomMax = computed(() => Math.max(DOCK_SIZES.bottom.min, Math.round(height.value * 0.6)))
// a stored size can exceed what this window allows; the handle drags from what is on screen
const dockWidth = computed(() => Math.min(workspace.dockWidth, dockMax.value))
const bottomHeight = computed(() => Math.min(workspace.bottomHeight, bottomMax.value))

// a desktop window has no page menu; text fields and the code editor keep theirs for paste and spelling
function onContextMenu(e: MouseEvent) {
  if (!(e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable="true"], .cm-editor')) e.preventDefault()
}

const releaseHandlers = registerHandlers({
  'mode.shader': () => router.push('/'),
  'mode.graph': () => router.push('/graph'),
  'mode.reference': () => router.push('/reference'),
  'help.reference': () => router.push('/reference'),
  'app.preferences': () => openSettings(),
  'help.launchScreen': () => { launchScreen.open = true },
  'help.about': () => { aboutOpen.value = true },
})
const removeKeyDispatcher = installKeyDispatcher()
onBeforeUnmount(() => {
  releaseHandlers()
  removeKeyDispatcher()
})
</script>

<template>
  <UApp>
    <div class="flex h-dvh flex-col bg-default text-default" @contextmenu="onContextMenu">
      <TitleBar />
      <div ref="workbench" class="flex min-h-0 flex-1">
        <div class="flex min-w-0 flex-1 flex-col">
          <main class="min-h-0 flex-1">
            <RouterView v-slot="{ Component }">
              <!-- keep pages alive so editor state survives switching modes -->
              <KeepAlive>
                <component :is="Component" />
              </KeepAlive>
            </RouterView>
          </main>
          <!-- the docks hide with v-show: their tab bodies (knob MIDI binding, scene polling) and the preview canvas stay mounted while collapsed -->
          <SplitHandle
            v-show="workspace.bottomVisible"
            :model-value="bottomHeight"
            orientation="horizontal"
            label="Resize bottom panel"
            :min="DOCK_SIZES.bottom.min"
            :max="bottomMax"
            :initial="DOCK_SIZES.bottom.initial"
            @update:model-value="workspace.bottomHeight = $event"
            @collapse="workspace.bottomVisible = false"
          />
          <BottomPanel v-show="workspace.bottomVisible" :style="{ height: `${bottomHeight}px` }" />
        </div>
        <SplitHandle
          v-show="dockShown"
          :model-value="dockWidth"
          orientation="vertical"
          label="Resize side panel"
          :min="DOCK_SIZES.right.min"
          :max="dockMax"
          :initial="DOCK_SIZES.right.initial"
          @update:model-value="workspace.dockWidth = $event"
          @collapse="workspace.dockVisible = false"
        />
        <RightDock v-show="dockShown" :style="{ width: `${dockWidth}px` }" />
      </div>
      <LedStrip v-if="workspace.stripVisible && isStripLayout(config.layout)" />
      <StatusBar />
    </div>
    <DockContribution tab="output">
      <OutputInspector />
    </DockContribution>
    <DockContribution tab="inputs">
      <InputsInspector />
    </DockContribution>
    <DockContribution tab="log">
      <LogPanel />
    </DockContribution>
    <DockContribution tab="performance">
      <PerformancePanel :stats="stats" :history="history" :target-fps="config.fps" :streaming="engine.streaming.value" />
    </DockContribution>
    <SettingsView />
    <CommandPalette />
    <LaunchScreen />
    <ShareAudioPrompt />
    <DropOverlay />
    <AboutDialog v-model:open="aboutOpen" />
  </UApp>
</template>
