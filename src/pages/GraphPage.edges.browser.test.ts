// One link added or removed must terminate and cost work proportional to the nodes it touches, at any graph size.
// bench-control-chain (344 nodes) is the smallest size at which the old code never settled.
import { afterEach, expect, it } from 'vitest'
import { KeepAlive, createApp, h } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import GraphPage from './GraphPage.vue'
import { config } from '@/lib/app/config'
import { graphFileBackendKey } from '@/lib/graph/model/document'
import { parseGraphFile } from '@/lib/graph/model/file'
import { preferences, resetPreferences } from '@/lib/app/preferences'
import { workspace } from '@/lib/app/workspace'
import chainFile from '../../graphs/bench/bench-control-chain.wledgraph?raw'

const FLOW_ID = 'wledtoy-graph'
const backend = { open: async () => null, save: async () => undefined, saveAs: async () => null }

let unmount: (() => void) | undefined
let updates = 0
let recursions = 0

const onRejection = (event: PromiseRejectionEvent) => {
  if (!String((event.reason as Error | undefined)?.message ?? event.reason).includes('Maximum recursive updates')) return
  recursions++
  event.preventDefault()
}

afterEach(() => {
  window.removeEventListener('unhandledrejection', onRejection)
  unmount?.()
  unmount = undefined
  config.graph = null
  resetPreferences()
  workspace.mode = 'shader'
})

const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0))

// Wall time is left to the editor benchmark: this page is shared with every other browser test file, so a run
// alongside them reads several times slower than a run on its own.
/** Runs until nothing re-renders for a while. */
async function settle(timeout = 20000) {
  const start = performance.now()
  let seen = updates
  let lastChange = start
  let quiet = 0
  while (performance.now() - start < timeout) {
    await macrotask()
    if (updates === seen) {
      if (++quiet >= 5) break
    } else {
      quiet = 0
      seen = updates
      lastChange = performance.now()
    }
  }
  return { ms: lastChange - start, settled: quiet >= 5 }
}

it('adding and removing a link on a 344-node graph settles, without re-rendering the canvas', { timeout: 120000 }, async () => {
  const doc = parseGraphFile(chainFile)
  config.graph = doc
  workspace.mode = 'graph'
  preferences.autosave = false
  window.addEventListener('unhandledrejection', onRejection)

  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h('div', { style: 'width: 1200px; height: 800px' }, h(KeepAlive, null, [h(GraphPage)])) })
  app.provide(graphFileBackendKey, backend)
  app.config.warnHandler = () => undefined
  app.mixin({ updated() { updates++ } })
  app.mount(root)
  unmount = () => { app.unmount(); root.remove() }
  await settle()
  expect(document.querySelectorAll('.vue-flow__node')).toHaveLength(doc.nodes.length)

  const flow = useVueFlow(FLOW_ID)
  const edge = { ...flow.edges.value[0] }

  updates = 0
  recursions = 0
  flow.removeEdges([edge.id])
  const removed = await settle()
  const removeUpdates = updates
  expect(recursions, 'removing a link re-triggers its own watcher').toBe(0)
  expect(removed.settled, 'removing a link settles').toBe(true)

  updates = 0
  flow.addEdges([edge])
  const added = await settle()
  const addUpdates = updates
  expect(recursions, 'adding a link re-triggers its own watcher').toBe(0)
  expect(added.settled, 'adding a link settles').toBe(true)

  // one link touches two nodes; a handful of components each, nowhere near the 344 on the canvas
  expect(removeUpdates, `removing a link updated ${removeUpdates} components`).toBeLessThan(50)
  expect(addUpdates, `adding a link updated ${addUpdates} components`).toBeLessThan(50)
})
