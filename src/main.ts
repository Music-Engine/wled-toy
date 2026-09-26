import '@fontsource-variable/jetbrains-mono'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'
import './assets/main.css'
import { createApp } from 'vue'
import ui from '@nuxt/ui/vue-plugin'
import App from './App.vue'
import { createTauriBackend, SHADER_FILES } from './lib/documents/file-backends'
import { graphFileBackendKey } from '@/lib/graph/model/document'
import { report } from './lib/app/logs'
import { installStorageNotice } from './lib/app/storage-notice'
import { installNativeMenu } from './lib/native/native-menu'
import { installNativeWindow } from './lib/native/native-window'
import { isTauri } from './lib/app/platform'
import { applyPreferences, launchPath, rememberMode } from './lib/app/preferences'
import { shaderFileBackendKey } from './lib/shader/shader-document'
import { loadTauriFiles } from './lib/documents/tauri-files'
import { router } from './router'

installStorageNotice()
applyPreferences()
const app = createApp(App).use(router).use(ui)
if (isTauri()) app.provide(graphFileBackendKey, createTauriBackend()).provide(shaderFileBackendKey, createTauriBackend(loadTauriFiles, SHADER_FILES))
const start = launchPath(location.pathname)
if (start) void router.replace(start)
router.afterEach((to, _from, failure) => { if (!failure) rememberMode(to.name) })
app.mount('#app')
if (isTauri()) {
  // after the mount, so the menu is built once with the handlers App.vue binds
  for (const install of [installNativeMenu, installNativeWindow]) install().catch((e) => report(e, 'Desktop shell'))
}
