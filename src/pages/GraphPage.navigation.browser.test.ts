import { afterEach, beforeEach, expect, it } from 'vitest'
import { cdp, page } from 'vitest/browser'
import { createApp, h, KeepAlive } from 'vue'
import { routerKey, type Router } from 'vue-router'
import { useVueFlow } from '@vue-flow/core'
import GraphPage from './GraphPage.vue'
import { isMac, runCommand } from '@/lib/app/commands'
import { config } from '@/lib/app/config'
import { GRAPH_NODE_TYPE, createDefaultGraph, newNodeData, type NodeGraph } from '@/lib/graph'
import { graphFileBackendKey } from '@/lib/graph/model/document'
import { workspace } from '@/lib/app/workspace'
import { logs } from '@/lib/app/logs'
import { graphCodeNotice } from '@/lib/shader/shader-export'
import '@vue-flow/core/dist/style.css'
import '@/assets/node-ui.css'

// Tailwind does not run in the tests; these are the utilities that give the canvas its size in the app
const layout = document.createElement('style')
layout.textContent = '.h-full { height: 100% } .flex { display: flex } .flex-col { flex-direction: column } .flex-1 { flex: 1 1 0% } .min-h-0 { min-height: 0 } .relative { position: relative }'
document.head.append(layout)

let unmount: (() => void) | undefined

function mount(graph: NodeGraph | null) {
  config.graph = graph
  const root = document.createElement('div')
  document.body.append(root)
  // the page listens for keys while it is the active page of a KeepAlive, as in the app
  const app = createApp({ render: () => h('div', { style: 'width: 1000px; height: 600px' }, h(KeepAlive, null, () => h(GraphPage))) })
  app.provide(graphFileBackendKey, { open: async () => null, save: async () => undefined, saveAs: async () => null })
  app.provide(routerKey, { push: async () => undefined } as unknown as Router)
  // Nuxt UI is not installed here; the page's own buttons render as unknown elements
  app.config.warnHandler = () => undefined
  app.mount(root)
  unmount = () => { app.unmount(); root.remove() }
}

const node = (id: string, kind: string, x: number, y: number) => ({ id, type: GRAPH_NODE_TYPE, position: { x, y }, data: newNodeData(kind) })

/** Three nodes far apart, so a box can touch one without coming near another; the knob has a text field. */
const spread = (): NodeGraph => ({ ...createDefaultGraph(), nodes: [node('a', 'uv', 0, 0), node('b', 'time', 900, 0), node('knob', 'knob', 0, 500)], edges: [], scenes: [] })

beforeEach(async () => {
  // the default test frame is narrower than the page, and a press outside the frame never arrives
  await page.viewport(1200, 800)
  for (const key of ['wledtoy:graph:recent', 'wledtoy:graph:recovery']) localStorage.removeItem(key)
  workspace.mode = 'graph'
})

afterEach(() => {
  unmount?.()
  unmount = undefined
  config.graph = null
  workspace.mode = 'shader'
})

const flow = () => useVueFlow('wledtoy-graph')
const selected = () => flow().getSelectedNodes.value.map((n) => n.id).sort()
const view = () => ({ ...flow().viewport.value })
const menuOpen = () => !!document.querySelector('[role="dialog"]')
const rectOf = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
const nodeRect = (id: string) => rectOf(`.vue-flow__node[data-id="${id}"]`)

async function ready(count: number) {
  await expect.poll(() => document.querySelectorAll('.vue-flow__node').length).toBe(count)
  await expect.poll(() => flow().fitViewOnInitDone.value).toBe(true)
  await expect.poll(() => nodeRect('a').width).toBeGreaterThan(0)
}

// Tests run inside an iframe, while the browser's input pipeline takes top-level viewport coordinates.
function toViewport(x: number, y: number) {
  const frame = window.frameElement?.getBoundingClientRect()
  return { x: x + (frame?.left ?? 0), y: y + (frame?.top ?? 0) }
}

interface Press { button?: 'left' | 'middle'; shift?: boolean; ctrl?: boolean }

/** A real press, move and release through the browser's input pipeline. */
async function drag(from: { x: number; y: number }, to: { x: number; y: number }, { button = 'left', shift = false, ctrl = false }: Press = {}) {
  const common = { button, clickCount: 1, modifiers: (shift ? 8 : 0) | (ctrl ? 2 : 0) }
  const held = button === 'left' ? 1 : 4
  await cdp().send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...toViewport(from.x, from.y), ...common, button: 'none', buttons: 0 })
  await cdp().send('Input.dispatchMouseEvent', { type: 'mousePressed', ...toViewport(from.x, from.y), ...common, buttons: held })
  for (let step = 1; step <= 4; step++) {
    await cdp().send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...toViewport(from.x + ((to.x - from.x) * step) / 4, from.y + ((to.y - from.y) * step) / 4), ...common, buttons: held })
  }
  await cdp().send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...toViewport(to.x, to.y), ...common, buttons: 0 })
}

async function wheel(at: { x: number; y: number }, deltaX: number, deltaY: number, ctrl = false) {
  // longer than the classifier's gesture window, so each call is judged on its own
  await new Promise((resolve) => setTimeout(resolve, 250))
  await cdp().send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...toViewport(at.x, at.y), deltaX, deltaY, modifiers: ctrl ? 2 : 0 })
}

const key = (letter: string, modifiers: KeyboardEventInit = {}, target: EventTarget = document.body) => {
  const event = new KeyboardEvent('keydown', { key: letter, bubbles: true, cancelable: true, ...modifiers })
  target.dispatchEvent(event)
  return event
}
const command = isMac() ? { metaKey: true } : { ctrlKey: true }

const paneCorner = (corner: 'left' | 'right') => {
  const pane = rectOf('.vue-flow__pane')
  return { x: corner === 'left' ? pane.left + 4 : pane.right - 4, y: pane.top + 4 }
}
const emptySpot = () => {
  const pane = rectOf('.vue-flow__pane')
  return { x: Math.round(pane.left + pane.width / 2), y: Math.round(pane.top + pane.height / 2) }
}
/** Where a flow point is on screen; it stays put when the view zooms around it. */
const flowPointAt = (at: { x: number; y: number }) => flow().screenToFlowCoordinate(at)

it('a left drag on the empty canvas box-selects the nodes the box touches and no others', async () => {
  mount(spread())
  await ready(3)
  const a = nodeRect('a')
  await drag(paneCorner('left'), { x: a.left + 8, y: a.top + 8 })
  await expect.poll(selected).toEqual(['a'])
  expect(document.querySelector('.vue-flow__nodesselection')).toBeNull()
})

it('a Shift drag adds to the selection, and a plain drag replaces it', async () => {
  mount(spread())
  await ready(3)
  const a = nodeRect('a')
  const b = nodeRect('b')
  await drag(paneCorner('left'), { x: a.left + 8, y: a.top + 8 })
  await expect.poll(selected).toEqual(['a'])
  await drag(paneCorner('right'), { x: b.right - 8, y: b.top + 8 }, { shift: true })
  await expect.poll(selected).toEqual(['a', 'b'])
  await drag(paneCorner('right'), { x: b.right - 8, y: b.top + 8 })
  await expect.poll(selected).toEqual(['b'])
})

it('a left drag on a node moves it instead of drawing a box', async () => {
  mount(spread())
  await ready(3)
  const before = nodeRect('b')
  const title = rectOf('.vue-flow__node[data-id="b"] .nui-title')
  await drag({ x: title.left + title.width / 2, y: title.top + title.height / 2 }, { x: title.left + title.width / 2 + 80, y: title.top + title.height / 2 + 40 })
  await expect.poll(() => nodeRect('b').left).toBeGreaterThan(before.left + 40)
  expect(nodeRect('b').top).toBeGreaterThan(before.top + 20)
})

it('a middle-button drag pans the view and selects nothing', async () => {
  mount(spread())
  await ready(3)
  const before = view()
  const from = emptySpot()
  await drag(from, { x: from.x + 120, y: from.y - 60 }, { button: 'middle' })
  await expect.poll(() => view().x).toBeCloseTo(before.x + 120, 0)
  expect(view().y).toBeCloseTo(before.y - 60, 0)
  expect(view().zoom).toBe(before.zoom)
  expect(selected()).toEqual([])
})

it('a mouse wheel zooms around the cursor: up is in, down is out', async () => {
  mount(spread())
  await ready(3)
  const before = view()
  // whole pixels: the browser rounds the position of the events it makes
  const at = { x: Math.round(nodeRect('b').left), y: Math.round(nodeRect('b').top) }
  const under = flowPointAt(at)
  await wheel(at, 0, -100)
  await expect.poll(() => view().zoom).toBeCloseTo(before.zoom * 1.2, 5)
  expect(flowPointAt(at).x).toBeCloseTo(under.x, 3)
  expect(flowPointAt(at).y).toBeCloseTo(under.y, 3)
  await wheel(at, 0, 100)
  await expect.poll(() => view().zoom).toBeCloseTo(before.zoom, 5)
})

it('two-finger trackpad scrolling pans on both axes and does not zoom', async () => {
  mount(spread())
  await ready(3)
  const before = view()
  await wheel(emptySpot(), 6, 14)
  await expect.poll(() => view().x).toBeCloseTo(before.x - 6, 3)
  expect(view().y).toBeCloseTo(before.y - 14, 3)
  expect(view().zoom).toBe(before.zoom)
})

it('a pinch, which is a trackpad scroll with Ctrl set, zooms', async () => {
  mount(spread())
  await ready(3)
  const before = view()
  const at = emptySpot()
  const under = flowPointAt(at)
  await wheel(at, 1, -10, true)
  await expect.poll(() => view().zoom).toBeCloseTo(before.zoom * 2 ** 0.2, 5)
  expect(flowPointAt(at).x).toBeCloseTo(under.x, 3)
})

it('the wheel over a field that uses it leaves the view alone', async () => {
  mount(null)
  await expect.poll(() => flow().fitViewOnInitDone.value).toBe(true)
  await expect.poll(() => document.querySelector('.vue-flow__node .nowheel')).not.toBeNull()
  const before = view()
  const field = rectOf('.vue-flow__node .nowheel')
  await wheel({ x: field.left + field.width / 2, y: field.top + field.height / 2 }, 0, -100)
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(view()).toEqual(before)
})

it('a Ctrl + middle-button drag zooms around the point where it began', async () => {
  mount(spread())
  await ready(3)
  const before = view()
  const from = emptySpot()
  const under = flowPointAt(from)
  await drag(from, { x: from.x + 100, y: from.y }, { button: 'middle', ctrl: true })
  await expect.poll(() => view().zoom).toBeCloseTo(before.zoom * 2 ** 0.5, 5)
  expect(flowPointAt(from).x).toBeCloseTo(under.x, 3)
  expect(flowPointAt(from).y).toBeCloseTo(under.y, 3)
  await drag(from, { x: from.x, y: from.y + 100 }, { button: 'middle', ctrl: true })
  await expect.poll(() => view().zoom).toBeCloseTo(before.zoom, 5)
})

it('Cmd+A selects every node and link and no longer opens the add menu; Escape and Alt+A deselect', async () => {
  mount(null)
  const all = createDefaultGraph()
  await expect.poll(() => document.querySelectorAll('.vue-flow__node').length).toBe(all.nodes.length)
  expect(key('a', command).defaultPrevented).toBe(true)
  await expect.poll(() => selected().length).toBe(all.nodes.length)
  expect(flow().getSelectedEdges.value.length).toBe(all.edges.length)
  expect(menuOpen()).toBe(false)

  expect(key('Escape').defaultPrevented).toBe(true)
  await expect.poll(() => selected().length).toBe(0)
  expect(flow().getSelectedEdges.value.length).toBe(0)

  key('a', command)
  await expect.poll(() => selected().length).toBe(all.nodes.length)
  key('å', { altKey: true, code: 'KeyA' })
  await expect.poll(() => selected().length).toBe(0)
})

it('Shift+A opens the add menu', async () => {
  mount(spread())
  await ready(3)
  expect(key('A', { shiftKey: true }).defaultPrevented).toBe(true)
  await expect.poll(menuOpen).toBe(true)
  expect(selected()).toEqual([])
})

it('keys typed in a node text field stay with the field', async () => {
  mount(spread())
  await ready(3)
  const input = document.querySelector<HTMLInputElement>('.vue-flow__node[data-id="knob"] input.nui-input')!
  input.focus()
  expect(key('a', {}, input).defaultPrevented).toBe(false)
  expect(key('A', { shiftKey: true }, input).defaultPrevented).toBe(false)
  expect(key('a', command, input).defaultPrevented).toBe(false)
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(menuOpen()).toBe(false)
  expect(selected()).toEqual([])
})

it('Send to Shader Mode writes code that stands alone: nothing in it reads the control slots shader mode leaves at zero', async () => {
  mount(null)
  await expect.poll(() => document.querySelectorAll('.vue-flow__node').length).toBe(createDefaultGraph().nodes.length)
  config.code = ''
  expect(runCommand('graph.sendToShader')).toBe(true)
  expect(config.code).toContain('void mainImage')
  expect(config.code).not.toContain('iControl')
})

it('Send to Shader Mode says which values it had to freeze, and says nothing when every node has GLSL of its own', async () => {
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
  expect(graphCodeNotice.value).toMatch(/^1 value is frozen in this code: Knob "Value" at [\d.]+\. It only updates inside a running graph/)
  expect(config.code).toMatch(/\/\/ Knob "Value" runs per frame; frozen at/)
  expect(logs.value.some((entry) => entry.level === 'warn' && entry.message === graphCodeNotice.value)).toBe(true)
  unmount!()

  mount({ ...createDefaultGraph(), nodes: [node('t', 'time', 0, 0), node('out', 'output', 400, 0)], edges: [{ id: 'e', source: 't', sourceHandle: 'time', target: 'out', targetHandle: 'color' }], scenes: [] })
  await expect.poll(mounted).toBe(2)
  expect(runCommand('graph.sendToShader')).toBe(true)
  expect(graphCodeNotice.value).toBeNull()
  expect(config.code).toContain('iTime')
})

it('Cmd+Z takes back a deleted node and a moved one, Cmd+Shift+Z brings the change back, and typing in a field keeps its own undo', async () => {
  mount(spread())
  await ready(3)
  const ids = () => flow().nodes.value.map((n) => n.id).sort()
  const xOf = (id: string) => flow().findNode(id)!.position.x
  const mod = isMac() ? { metaKey: true } : { ctrlKey: true }
  // a change becomes one undo step once it has paused
  const settle = () => new Promise((resolve) => setTimeout(resolve, 450))

  flow().updateNode('b', { position: { x: 700, y: 0 } })
  await settle()
  flow().removeNodes(['a'])
  await settle()
  expect(ids()).toEqual(['b', 'knob'])

  key('z', mod)
  await expect.poll(ids).toEqual(['a', 'b', 'knob'])
  key('z', mod)
  await expect.poll(() => xOf('b')).toBe(900)
  key('z', mod)
  await settle()
  expect([ids(), xOf('b')]).toEqual([['a', 'b', 'knob'], 900])

  key('z', { ...mod, shiftKey: true })
  await expect.poll(() => xOf('b')).toBe(700)
  runCommand('graph.redo')
  await expect.poll(ids).toEqual(['b', 'knob'])

  const field = document.querySelector<HTMLInputElement>('.vue-flow__node[data-id="knob"] input')!
  field.focus()
  const typed = key('z', mod, field)
  expect(typed.defaultPrevented).toBe(false)
  await settle()
  expect(ids()).toEqual(['b', 'knob'])
})
