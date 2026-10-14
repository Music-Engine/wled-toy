import { expect } from 'vitest'
import { createApp, h, KeepAlive } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import GraphPage from '@/pages/GraphPage.vue'
import { installKeyDispatcher } from '@/lib/app/commands'
import { config } from '@/lib/app/settings/config'
import { createDefaultGraph } from '@/lib/graph'
import { graphFileBackendKey } from '@/lib/graph/model/document'
import { workspace } from '@/lib/app/workspace'

/** The graph page as the app shows it, keys going through the app's dispatcher, once the default graph is drawn and fitted. Returns the unmount. */
export async function mountGraphPage(): Promise<() => void> {
  for (const key of ['wledtoy:graph:recent', 'wledtoy:graph:recovery']) localStorage.removeItem(key)
  config.graph = null
  workspace.mode = 'graph'
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () =>
      h(
        'div',
        { style: 'width: 1000px; height: 600px' },
        h(KeepAlive, null, () => h(GraphPage)),
      ),
  })
  app.provide(graphFileBackendKey, { open: async () => null, save: async () => undefined, saveAs: async () => null })
  // Nuxt UI and the router are not installed here; the page's own buttons render as unknown elements
  app.config.warnHandler = () => undefined
  app.mount(root)
  const removeKeys = installKeyDispatcher()
  await expect.poll(() => document.querySelectorAll('.vue-flow__node').length).toBe(createDefaultGraph().nodes.length)
  // pointer math reads the zoom the canvas settles on
  await expect.poll(() => useVueFlow('wledtoy-graph').fitViewOnInitDone.value).toBe(true)
  return () => {
    removeKeys()
    app.unmount()
    root.remove()
  }
}
