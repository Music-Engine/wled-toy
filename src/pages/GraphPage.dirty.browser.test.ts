// What "edited" means, pinned before the document snapshot work moved off the per-change path.
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createApp, h } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import GraphPage from './GraphPage.vue'
import TitleBar from '@/components/shell/TitleBar.vue'
import { runCommand } from '@/lib/app/commands'
import { config } from '@/lib/app/config'
import { activeGraphDocument, graphFileBackendKey } from '@/lib/graph/model/document'
import { parseGraphFile } from '@/lib/graph/model/file'
import { preferences, resetPreferences } from '@/lib/app/preferences'
import { workspace } from '@/lib/app/workspace'
import type { GraphNodeData } from '@/lib/graph'

const FLOW_ID = 'wledtoy-graph'
const files: Record<string, string> = {}
const backend = {
  open: async () => null,
  save: async (handle: { name: string }, text: string) => { files[handle.name] = text },
  saveAs: async (text: string, suggestedName: string) => {
    files[suggestedName] = text
    return { handle: { name: suggestedName }, text }
  },
}

let unmount: (() => void) | undefined

function mount() {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => [h(TitleBar), h('div', { style: 'width: 1000px; height: 600px' }, h(GraphPage))] })
  app.provide(graphFileBackendKey, backend)
  app.config.warnHandler = () => undefined
  app.mount(root)
  unmount = () => { app.unmount(); root.remove() }
}

const dirty = () => !!activeGraphDocument.value?.store.dirty.value
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  for (const key of Object.keys(files)) delete files[key]
  localStorage.removeItem('wledtoy:graph:recent')
  localStorage.removeItem('wledtoy:graph:recovery')
  preferences.autosave = false
  config.graph = null
  workspace.mode = 'graph'
})

afterEach(() => {
  unmount?.()
  unmount = undefined
  localStorage.removeItem('wledtoy:graph:recent')
  localStorage.removeItem('wledtoy:graph:recovery')
  resetPreferences()
  config.graph = null
  workspace.mode = 'shader'
})

/** The first node of the default graph with a numeric field, and the field's name. */
function editableField() {
  const flow = useVueFlow(FLOW_ID)
  const node = flow.getNodes.value.find((n) => Object.values((n.data as GraphNodeData).values).some((v) => typeof v === 'number'))!
  const name = Object.entries((node.data as GraphNodeData).values).find(([, v]) => typeof v === 'number')![0]
  return { flow, node, name, value: (node.data as GraphNodeData).values[name] as number }
}

const setField = (to: number) => {
  const { flow, node, name } = editableField()
  flow.updateNodeData<GraphNodeData>(node.id, { values: { ...(node.data as GraphNodeData).values, [name]: to } })
}

it('an edit marks the document edited, a save clears it, and an undo back to the saved state clears it too', async () => {
  mount()
  await expect.poll(() => document.querySelectorAll('.vue-flow__node').length).toBeGreaterThan(0)
  runCommand('file.save')
  await expect.poll(dirty).toBe(false)
  expect(files['graph.wledgraph']).toBeDefined()

  const original = editableField().value
  setField(original + 3)
  await expect.poll(dirty).toBe(true)
  // the undo recorder waits out a 350 ms pause before the edit becomes a step of its own
  await pause(500)

  expect(runCommand('graph.undo')).toBe(true)
  await expect.poll(() => editableField().value).toBe(original)
  await expect.poll(dirty, { timeout: 2000 }).toBe(false)
})

it('a save after an edit stores the edit, and the working copy survives a pagehide mid-gesture', async () => {
  mount()
  await expect.poll(() => document.querySelectorAll('.vue-flow__node').length).toBeGreaterThan(0)
  runCommand('file.save')
  await expect.poll(dirty).toBe(false)

  const { node, name } = editableField()
  setField(42.5)
  // a closing window gets the latest state without waiting for any pause to expire
  window.dispatchEvent(new Event('pagehide'))
  const saved = config.graph!.nodes.find((n) => n.id === node.id)!
  expect(saved.data!.values[name]).toBe(42.5)

  runCommand('file.save')
  await expect.poll(dirty).toBe(false)
  expect(parseGraphFile(files['graph.wledgraph']).nodes.find((n) => n.id === node.id)!.data!.values[name]).toBe(42.5)
})
