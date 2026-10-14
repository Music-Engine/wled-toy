import { afterEach, beforeEach, expect, it } from 'vitest'
import { createApp, h, KeepAlive } from 'vue'
import { routerKey, type Router } from 'vue-router'
import GraphPage from './GraphPage.vue'
import { runCommand } from '@/lib/app/commands'
import { config } from '@/lib/app/settings/config'
import { GRAPH_NODE_TYPE, createDefaultGraph, newNodeData, type NodeGraph } from '@/lib/graph'
import { graphFileBackendKey } from '@/lib/graph/model/document'
import { workspace } from '@/lib/app/workspace'
import { logs } from '@/lib/app/logs'
import { graphCodeNotice } from '@/lib/shader/shader-export'

let unmount: (() => void) | undefined

function mount(graph: NodeGraph | null) {
  config.graph = graph
  const root = document.createElement('div')
  document.body.append(root)
  // the page binds its commands while it is the active page of a KeepAlive
  const app = createApp({
    render: () =>
      h(
        'div',
        { style: 'width: 1000px; height: 600px' },
        h(KeepAlive, null, () => h(GraphPage)),
      ),
  })
  app.provide(graphFileBackendKey, { open: async () => null, save: async () => undefined, saveAs: async () => null })
  app.provide(routerKey, { push: async () => undefined } as unknown as Router)
  // Nuxt UI is not installed here; the page's own buttons render as unknown elements
  app.config.warnHandler = () => undefined
  app.mount(root)
  unmount = () => {
    app.unmount()
    root.remove()
  }
}

const node = (id: string, kind: string, x: number, y: number) => ({ id, type: GRAPH_NODE_TYPE, position: { x, y }, data: newNodeData(kind) })

beforeEach(() => {
  for (const key of ['wledtoy:graph:recent', 'wledtoy:graph:recovery']) localStorage.removeItem(key)
  workspace.mode = 'graph'
})

afterEach(() => {
  unmount?.()
  unmount = undefined
  config.graph = null
  workspace.mode = 'shader'
})

it('Send to Shader Mode writes code that stands alone: nothing in it reads the control slots shader mode leaves at zero', async () => {
  mount(null)
  await expect.poll(() => document.querySelectorAll('.vue-flow__node').length).toBe(createDefaultGraph().nodes.length)
  config.code = ''
  expect(runCommand('graph.sendToShader')).toBe(true)
  expect(config.code).toContain('void mainImage')
  expect(config.code).not.toContain('iControl')
})

it('Send to Shader Mode says which values it had to fix, and says nothing when the graph needs no host', async () => {
  const knob: NodeGraph = {
    ...createDefaultGraph(),
    nodes: [node('knob', 'knob', 0, 0), node('out', 'output', 400, 0)],
    edges: [{ id: 'e', source: 'knob', sourceHandle: 'value', target: 'out', targetHandle: 'color' }],
    scenes: [],
  }
  mount(knob)
  const mounted = () => document.querySelectorAll('.vue-flow__node').length
  await expect.poll(mounted).toBe(2)
  logs.value = []
  expect(runCommand('graph.sendToShader')).toBe(true)
  expect(graphCodeNotice.value).toMatch(/^This code differs from the running graph: Knob "Value" is fixed at [\d.]+ in the exported shader\.$/)
  expect(config.code).not.toContain('iControl')
  expect(logs.value.some((entry) => entry.level === 'warn' && entry.message === graphCodeNotice.value)).toBe(true)
  unmount!()

  mount({
    ...createDefaultGraph(),
    nodes: [node('t', 'time', 0, 0), node('out', 'output', 400, 0)],
    edges: [{ id: 'e', source: 't', sourceHandle: 'time', target: 'out', targetHandle: 'color' }],
    scenes: [],
  })
  await expect.poll(mounted).toBe(2)
  expect(runCommand('graph.sendToShader')).toBe(true)
  expect(graphCodeNotice.value).toBeNull()
  expect(config.code).toContain('iTime')
})
