import { afterEach, beforeEach, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { createApp, h, KeepAlive } from 'vue'
import { routerKey, type Router } from 'vue-router'
import { useVueFlow } from '@vue-flow/core'
import DropOverlay from './DropOverlay.vue'
import GraphPage from '@/pages/GraphPage.vue'
import { installKeyDispatcher, isMac } from '@/lib/app/commands'
import { config } from '@/lib/app/config'
import { logs } from '@/lib/app/logs'
import { workspace } from '@/lib/app/workspace'
import { documentSessions } from '@/lib/documents/document-session'
import { DocumentError } from '@/lib/documents/document-error'
import { useEngine } from '@/lib/engine/engine'
import { GRAPH_NODE_TYPE, createDefaultGraph, newNodeData, type NodeGraph, type GraphNodeData } from '@/lib/graph'
import { graphFileBackendKey } from '@/lib/graph/model/document'
import { serializeGraphFile } from '@/lib/graph/model/file'
import '@vue-flow/core/dist/style.css'
import '@/features/node-ui/node-ui.css'

// Tailwind does not run in the tests; these are the utilities that give the canvas its size in the app
const layout = document.createElement('style')
layout.textContent = '.h-full { height: 100% } .flex { display: flex } .flex-col { flex-direction: column } .flex-1 { flex: 1 1 0% } .min-h-0 { min-height: 0 } .relative { position: relative }'
document.head.append(layout)

let unmount: (() => void) | undefined
let pushed: string[] = []

function mount(graph: NodeGraph | null) {
  config.graph = graph
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () => h('div', { style: 'width: 1000px; height: 600px' }, [h(KeepAlive, null, () => h(GraphPage)), h(DropOverlay)]),
  })
  app.provide(graphFileBackendKey, { open: async () => null, save: async () => undefined, saveAs: async () => null, reopen: async () => { throw new DocumentError('file-gone', 'it is gone') } })
  app.provide(routerKey, { push: async (path: string) => { pushed.push(path) } } as unknown as Router)
  // Nuxt UI is not installed here; the page's own buttons render as unknown elements
  app.config.warnHandler = () => undefined
  app.mount(root)
  const removeKeys = installKeyDispatcher()
  unmount = () => { removeKeys(); app.unmount(); root.remove() }
}

const node = (id: string, kind: string, x: number, y: number) => ({ id, type: GRAPH_NODE_TYPE, position: { x, y }, data: newNodeData(kind) })
const small = (): NodeGraph => ({ ...createDefaultGraph(), nodes: [node('a', 'uv', 0, 0), node('b', 'time', 400, 200)], edges: [], scenes: [] })

beforeEach(async () => {
  await page.viewport(1200, 800)
  for (const key of ['wledtoy:graph:recent', 'wledtoy:graph:recovery']) localStorage.removeItem(key)
  workspace.mode = 'graph'
  pushed = []
  logs.value = []
})

afterEach(() => {
  unmount?.()
  unmount = undefined
  config.graph = null
  workspace.mode = 'shader'
})

const flow = () => useVueFlow('wledtoy-graph')
const overlay = () => document.querySelector<HTMLElement>('.drop-overlay')
const messages = () => logs.value.map((entry) => `${entry.level}: ${entry.message}`)
const kinds = () => flow().getNodes.value.map((n) => (n.data as GraphNodeData).kind).sort()

async function ready(count: number) {
  await expect.poll(() => document.querySelectorAll('.vue-flow__node').length).toBe(count)
  await expect.poll(() => flow().fitViewOnInitDone.value).toBe(true)
  await expect.poll(() => !!documentSessions.graph).toBe(true)
}

function transfer(files: File[]) {
  const data = new DataTransfer()
  for (const file of files) data.items.add(file)
  return data
}

/** The events a drag from the desktop fires, on the element under the point, with a DataTransfer the page can read. */
function fire(type: 'dragenter' | 'dragover' | 'dragleave' | 'drop', dataTransfer: DataTransfer, at = { x: 500, y: 300 }) {
  const event = new DragEvent(type, { dataTransfer, bubbles: true, cancelable: true, clientX: at.x, clientY: at.y })
  ;(document.elementFromPoint(at.x, at.y) ?? document.body).dispatchEvent(event)
  return event
}

function dropFiles(files: File[], at?: { x: number; y: number }) {
  const data = transfer(files)
  fire('dragenter', data, at)
  fire('dragover', data, at)
  return fire('drop', data, at)
}

function wav(seconds: number) {
  const rate = 8000
  const samples = rate * seconds
  const view = new DataView(new ArrayBuffer(44 + samples * 2))
  const text = (offset: number, value: string) => [...value].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)))
  text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, samples * 2, true)
  return new File([view.buffer], 'drop.wav', { type: 'audio/wav' })
}

async function png(name: string) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 4
  canvas.getContext('2d')!.fillRect(0, 0, 4, 4)
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((made) => resolve(made!), 'image/png'))
  return new File([blob], name, { type: 'image/png' })
}

it('says what a dragged file will do, takes the drop from the browser, and goes away when the drag leaves', async () => {
  mount(small())
  await ready(2)
  const data = transfer([wav(1)])
  fire('dragenter', data)
  await expect.poll(() => overlay()?.textContent?.trim()).toBe('Drop to use as the audio track')
  expect(fire('dragover', data).defaultPrevented).toBe(true)
  fire('dragleave', data)
  await expect.poll(() => overlay()).toBeNull()

  fire('dragenter', transfer([new File(['x'], 'aurora.wledgraph')]))
  await expect.poll(() => overlay()?.textContent?.trim()).toBe('Drop file')
  fire('dragleave', data)
  await expect.poll(() => overlay()).toBeNull()
})

it('leaves a drag without files alone: no overlay, and the event stays with whoever owns it', async () => {
  mount(small())
  await ready(2)
  const data = new DataTransfer()
  data.setData('text/plain', 'a selection')
  fire('dragenter', data)
  const over = fire('dragover', data)
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(overlay()).toBeNull()
  expect(over.defaultPrevented).toBe(false)
  expect(fire('drop', data).defaultPrevented).toBe(false)
  expect(messages()).toEqual([])
})

it('an audio file becomes the track and the source switches to the file', async () => {
  mount(small())
  await ready(2)
  const engine = useEngine()
  try {
    expect(dropFiles([wav(1)]).defaultPrevented).toBe(true)
    await expect.poll(() => engine.audio.state.fileName).toBe('drop.wav')
    await expect.poll(() => messages()).toContain('info: Using your song: drop.wav')
    expect(engine.audio.state.settings.source).toBe('file')
    expect(overlay()).toBeNull()
  } finally {
    await engine.useSong(null)
  }
})

it('bytes that only claim to be audio are refused with the error line the status bar shows, and the track stays', async () => {
  mount(small())
  await ready(2)
  const engine = useEngine()
  const before = engine.audio.state.fileName
  dropFiles([new File(['not audio'], 'fake.mp3', { type: 'audio/mpeg' })])
  await expect.poll(() => logs.value.at(-1)).toMatchObject({ level: 'error', message: expect.stringContaining('fake.mp3 could not be decoded') })
  expect(engine.audio.state.fileName).toBe(before)
})

it('an image dropped on the canvas becomes a selected Image Texture node there, pointing at the new library image, and Cmd+Z takes it back', async () => {
  mount(small())
  await ready(2)
  const engine = useEngine()
  const name = `drop-${Date.now()}.png`
  const canvas = document.querySelector('.vue-flow')!.getBoundingClientRect()
  const at = { x: Math.round(canvas.left + 320), y: Math.round(canvas.top + 140) }
  try {
    const file = await png(name)
    // an edit made a moment before the drop is a step of its own, not part of the drop's
    flow().addNodes([node('extra', 'time', 50, 300)])
    await expect.poll(() => kinds()).toEqual(['time', 'time', 'uv'])
    dropFiles([file], at)
    await expect.poll(() => kinds()).toEqual(['imageTexture', 'time', 'time', 'uv'])
    const added = flow().getNodes.value.find((n) => (n.data as GraphNodeData).kind === 'imageTexture')!
    expect((added.data as GraphNodeData).values.filename).toBe(name)
    expect(engine.images.get(name)?.blob?.size).toBeGreaterThan(0)
    const expected = flow().screenToFlowCoordinate(at)
    expect(added.position.x).toBeCloseTo(expected.x, 3)
    expect(added.position.y).toBeCloseTo(expected.y, 3)
    await expect.poll(() => flow().getSelectedNodes.value.map((n) => n.id)).toEqual([added.id])

    await userEvent.keyboard(isMac() ? '{Meta>}z{/Meta}' : '{Control>}z{/Control}')
    await expect.poll(() => kinds()).toEqual(['time', 'time', 'uv'])
    await userEvent.keyboard(isMac() ? '{Meta>}z{/Meta}' : '{Control>}z{/Control}')
    await expect.poll(() => kinds()).toEqual(['time', 'uv'])
  } finally {
    await engine.images.remove(name)
  }
})

it('a .wledgraph opens through the graph document: named after the file, clean, and out of the recent list', async () => {
  mount(small())
  await ready(2)
  const incoming: NodeGraph = { ...createDefaultGraph(), nodes: [node('only', 'time', 10, 10)], edges: [], scenes: [] }
  dropFiles([new File([serializeGraphFile(incoming)], 'aurora.wledgraph')])
  await expect.poll(() => flow().getNodes.value.map((n) => n.id)).toEqual(['only'])
  const session = documentSessions.graph!
  expect(pushed).toEqual(['/graph'])
  expect(session.name.value).toBe('aurora.wledgraph')
  await expect.poll(() => session.store.dirty.value).toBe(false)
  expect(session.store.recentFiles.value).toEqual([])
  expect(messages()).toContain('info: Opened aurora.wledgraph')
})

it('a saved graph that was renamed to .json still opens as a graph, and a settings export still imports', async () => {
  mount(small())
  await ready(2)
  const incoming: NodeGraph = { ...createDefaultGraph(), nodes: [node('only', 'time', 10, 10)], edges: [], scenes: [] }
  dropFiles([new File([serializeGraphFile(incoming)], 'aurora.json', { type: 'application/json' })])
  await expect.poll(() => flow().getNodes.value.map((n) => n.id)).toEqual(['only'])
  expect(documentSessions.graph!.name.value).toBe('aurora.json')
  expect(messages().join('\n')).not.toContain('is not a WLEDtoy settings file')

  dropFiles([new File([JSON.stringify({ app: 'wledtoy', version: 3, fps: 42 })], 'settings.json', { type: 'application/json' })])
  await expect.poll(() => messages().some((m) => m.startsWith('info: Imported settings.json'))).toBe(true)
  expect(flow().getNodes.value.map((n) => n.id)).toEqual(['only'])
})

it('asks first when the graph has unsaved work: Cancel keeps it, Discard opens the dropped file', async () => {
  mount(small())
  await ready(2)
  const session = documentSessions.graph!
  flow().addNodes([node('extra', 'time', 50, 300)])
  await expect.poll(() => session.store.dirty.value).toBe(true)
  const dialog = () => document.querySelector<HTMLElement>('.graph-document-dialog')
  const incoming = new File([serializeGraphFile({ ...createDefaultGraph(), nodes: [node('only', 'time', 10, 10)], edges: [], scenes: [] })], 'aurora.wledgraph')

  dropFiles([incoming])
  await expect.poll(() => dialog()?.textContent).toContain('Save changes to Untitled?')
  dialog()!.querySelector<HTMLButtonElement>('[data-choice="cancel"]')!.click()
  await expect.poll(() => dialog()).toBeNull()
  expect(flow().getNodes.value.map((n) => n.id).sort()).toEqual(['a', 'b', 'extra'])

  dropFiles([incoming])
  await expect.poll(() => dialog()).not.toBeNull()
  dialog()!.querySelector<HTMLButtonElement>('[data-choice="discard"]')!.click()
  await expect.poll(() => flow().getNodes.value.map((n) => n.id)).toEqual(['only'])
  expect(session.name.value).toBe('aurora.wledgraph')
})

it('a .wledgraph that does not parse reports like File > Open does and leaves the graph alone', async () => {
  mount(small())
  await ready(2)
  dropFiles([new File(['{ "app": "something else" }'], 'broken.wledgraph')])
  await expect.poll(() => documentSessions.graph!.error.value).toBe('Open failed: This is not a wledtoy graph file (found app "something else").')
  expect(messages()).toContain('error: Open failed: This is not a wledtoy graph file (found app "something else").')
  expect(documentSessions.graph!.name.value).toBe('Untitled')
  expect(flow().getNodes.value.map((n) => n.id).sort()).toEqual(['a', 'b'])
})

it('a text file is refused with one warning that names it, and a JSON that is no settings export says so', async () => {
  mount(small())
  await ready(2)
  const dropped = dropFiles([new File(['hello'], 'notes.txt', { type: 'text/plain' })])
  expect(dropped.defaultPrevented).toBe(true)
  await expect.poll(() => messages()).toEqual(['warn: notes.txt was not opened: WLEDtoy takes audio, images, .wledgraph, .glsl and settings files'])
  expect(kinds()).toEqual(['time', 'uv'])

  logs.value = []
  dropFiles([new File(['{"name":"package"}'], 'package.json', { type: 'application/json' })])
  await expect.poll(() => messages()).toEqual(['warn: package.json is not a WLEDtoy settings file'])
})

it('several files: one of a kind is used, the second graph is skipped and said so', async () => {
  mount(small())
  await ready(2)
  const graph = (id: string) => serializeGraphFile({ ...createDefaultGraph(), nodes: [node(id, 'time', 10, 10)], edges: [], scenes: [] })
  dropFiles([new File([graph('first')], 'first.wledgraph'), new File([graph('second')], 'second.wledgraph'), new File(['x'], 'notes.txt')])
  await expect.poll(() => flow().getNodes.value.map((n) => n.id)).toEqual(['first'])
  expect(messages()).toContain('warn: Skipped second.wledgraph: one graph file per drop')
  expect(messages().filter((line) => line.includes('notes.txt'))).toHaveLength(1)
})
