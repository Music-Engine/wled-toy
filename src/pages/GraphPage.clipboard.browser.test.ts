import { afterEach, beforeEach, expect, it } from 'vitest'
import { createApp, h, KeepAlive } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import GraphPage from './GraphPage.vue'
import { installKeyDispatcher, isMac } from '@/lib/app/commands'
import { config } from '@/lib/app/settings/config'
import { createDefaultGraph } from '@/lib/graph'
import { graphFileBackendKey } from '@/lib/graph/model/document'
import { logs } from '@/lib/app/logs'
import { workspace } from '@/lib/app/workspace'

let unmount: (() => void) | undefined

beforeEach(() => {
  for (const key of ['wledtoy:graph:recent', 'wledtoy:graph:recovery']) localStorage.removeItem(key)
  config.graph = null
  workspace.mode = 'graph'
  logs.value = []
  const root = document.createElement('div')
  document.body.append(root)
  // the page listens for clipboard events while it is the active page of a KeepAlive, and keys come through the app's dispatcher
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
  unmount = () => {
    removeKeys()
    app.unmount()
    root.remove()
  }
})

afterEach(() => {
  unmount?.()
  config.graph = null
  workspace.mode = 'shader'
})

const defaultNodes = createDefaultGraph().nodes.length
const nodeCount = () => document.querySelectorAll('.vue-flow__node').length
const logged = (text: string) => logs.value.filter((line) => line.message.startsWith(text)).length

async function selectNodes(count: number) {
  await expect.poll(nodeCount).toBe(defaultNodes)
  const flow = useVueFlow('wledtoy-graph')
  flow.addSelectedNodes(flow.getNodes.value.slice(0, count))
  await expect.poll(() => flow.getSelectedNodes.value.length).toBe(count)
}

/** What the page gets from the native Edit menu: the clipboard event and no key. */
function clipboard(type: 'copy' | 'cut' | 'paste', target: EventTarget = document.body) {
  const event = new ClipboardEvent(type, { bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

const key = (letter: string) => {
  const event = new KeyboardEvent('keydown', { key: letter, bubbles: true, cancelable: true, ...(isMac() ? { metaKey: true } : { ctrlKey: true }) })
  document.body.dispatchEvent(event)
  return event
}

it('copy and paste events copy and paste the selected nodes, and take the event from the browser', async () => {
  await selectNodes(2)
  expect(clipboard('copy').defaultPrevented).toBe(true)
  expect(logged('Copied 2 nodes')).toBe(1)
  expect(clipboard('paste').defaultPrevented).toBe(true)
  await expect.poll(nodeCount).toBe(defaultNodes + 2)
})

it('with no node selected the events stay with the browser', async () => {
  await expect.poll(nodeCount).toBe(defaultNodes)
  expect(clipboard('copy').defaultPrevented).toBe(false)
  expect(clipboard('paste').defaultPrevented).toBe(false)
  expect(nodeCount()).toBe(defaultNodes)
})

it('a text field keeps its own copy and paste', async () => {
  await selectNodes(1)
  const input = document.createElement('input')
  document.body.append(input)
  try {
    expect(clipboard('copy', input).defaultPrevented).toBe(false)
    expect(logged('Copied')).toBe(0)
    clipboard('copy')
    expect(clipboard('paste', input).defaultPrevented).toBe(false)
    expect(nodeCount()).toBe(defaultNodes)
  } finally {
    input.remove()
  }
})

it('one gesture runs one action: a clipboard event that follows a handled key does nothing more', async () => {
  await selectNodes(1)
  expect(key('c').defaultPrevented).toBe(true)
  clipboard('copy')
  expect(logged('Copied')).toBe(1)

  expect(key('v').defaultPrevented).toBe(true)
  clipboard('paste')
  await expect.poll(nodeCount).toBe(defaultNodes + 1)
  await new Promise((resolve) => setTimeout(resolve, 150))
  expect(nodeCount()).toBe(defaultNodes + 1)
  expect(logged('Pasted')).toBe(1)
})

it('a page that is not the active one ignores the events', async () => {
  await selectNodes(1)
  unmount!()
  unmount = undefined
  expect(clipboard('copy').defaultPrevented).toBe(false)
  expect(logged('Copied')).toBe(0)
})
