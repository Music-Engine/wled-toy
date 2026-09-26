import { afterEach, beforeEach, expect, it } from 'vitest'
import { createApp, h } from 'vue'
import GraphPage from './GraphPage.vue'
import TitleBar from '@/features/shell/TitleBar.vue'
import { commands, runCommand } from '@/lib/app/commands'
import { config } from '@/lib/app/settings/config'
import type { FileBackend } from '@/lib/documents/files/file-backends'
import { DocumentError } from '@/lib/documents/document-error'
import { createDefaultGraph, type NodeGraph } from '@/lib/graph'
import { activeGraphDocument, graphFileBackendKey } from '@/lib/graph/model/document'
import { readGraphFile, serializeGraphFile } from '@/lib/graph/model/file'
import { logs } from '@/lib/app/logs'
import { preferences, resetPreferences } from '@/lib/app/settings/preferences'
import { workspace } from '@/lib/app/workspace'
import sampleFile from '../../graphs/high-contrast-music.wledgraph?raw'

/** The disk and its dialogs: `pick` is the file the user chooses in the Open dialog, null when they cancel it. */
function fakeDisk(files: Record<string, string>) {
  const dialog = { pick: null as string | null }
  const backend: Required<FileBackend> = {
    open: async () => (dialog.pick === null ? null : { handle: { name: dialog.pick }, text: files[dialog.pick] }),
    save: async (handle, text) => { files[handle.name] = text },
    saveAs: async (text, suggestedName) => {
      files[suggestedName] = text
      return { handle: { name: suggestedName }, text }
    },
    reopen: async (name) => {
      if (!(name in files)) throw new DocumentError('file-gone', 'it was deleted')
      return { handle: { name }, text: files[name] }
    },
  }
  return { files, dialog, backend }
}

let unmount: (() => void) | undefined

function mount(backend: FileBackend) {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => [h(TitleBar), h('div', { style: 'width: 1000px; height: 600px' }, h(GraphPage))] })
  app.provide(graphFileBackendKey, backend)
  // Nuxt UI and the router are not installed here; the page's own buttons render as unknown elements
  app.config.warnHandler = () => undefined
  app.mount(root)
  unmount = () => { app.unmount(); root.remove() }
}

const clearStored = () => ['wledtoy:graph:recent', 'wledtoy:graph:recovery'].forEach((key) => localStorage.removeItem(key))

beforeEach(() => {
  clearStored()
  // the shortest interval the preference allows, so the recovery cases do not wait out the 5 s default
  preferences.autosaveSeconds = 1
  config.graph = null
  workspace.mode = 'graph'
})

afterEach(() => {
  unmount?.()
  unmount = undefined
  clearStored()
  resetPreferences()
  config.graph = null
  workspace.mode = 'shader'
})

const titleBarText = () => document.querySelector('.document-name')?.textContent?.replace(/\s+/g, ' ').trim()
const nodeCount = () => document.querySelectorAll('.vue-flow__node').length
const dialog = () => document.querySelector<HTMLElement>('.graph-document-dialog')
const choose = (choice: string) => dialog()!.querySelector<HTMLButtonElement>(`[data-choice="${choice}"]`)!.click()
const recentIds = () => commands.value.filter((command) => command.id.startsWith('file.recent.')).map((command) => command.id)

const sample = readGraphFile(sampleFile).doc
const defaultNodes = createDefaultGraph().nodes.length

/** What another tab's save or an import does to this editor: the working copy changes under it. */
function editFromOutside(doc: NodeGraph): NodeGraph {
  const edited = { ...doc, nodes: doc.nodes.map((n, i) => (i === 0 ? { ...n, position: { x: n.position.x + 75, y: n.position.y + 25 } } : n)) }
  config.graph = edited
  return edited
}

async function openFile(disk: ReturnType<typeof fakeDisk>, name: string) {
  disk.dialog.pick = name
  expect(runCommand('file.open')).toBe(true)
}

it('starts as a clean Untitled document', async () => {
  mount(fakeDisk({}).backend)
  await expect.poll(titleBarText).toBe('Untitled')
  await expect.poll(nodeCount).toBe(defaultNodes)
  expect(document.title).toMatch(/^Untitled - /)
  expect(dialog()).toBeNull()

  workspace.mode = 'shader'
  await expect.poll(titleBarText).toBeUndefined()
  expect(document.title).not.toContain('Untitled')
})

it('opens a file, marks an edit, and saves the edit back into the file', async () => {
  const disk = fakeDisk({ 'music.wledgraph': sampleFile })
  mount(disk.backend)
  await expect.poll(titleBarText).toBe('Untitled')

  await openFile(disk, 'music.wledgraph')
  await expect.poll(nodeCount).toBe(sample.nodes.length)
  // stays clean once Vue Flow and the node bodies have settled on the loaded graph
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(titleBarText()).toBe('music.wledgraph')
  expect(document.title).toMatch(/^music\.wledgraph - /)

  const edited = editFromOutside(sample)
  await expect.poll(titleBarText).toBe('music.wledgraph · Edited')
  expect(document.title).toMatch(/^music\.wledgraph \(edited\) - /)

  runCommand('file.save')
  await expect.poll(titleBarText).toBe('music.wledgraph')
  expect(readGraphFile(disk.files['music.wledgraph']).doc.nodes[0].position).toEqual(edited.nodes[0].position)
  expect(readGraphFile(disk.files['music.wledgraph']).doc.edges).toHaveLength(sample.edges.length)
})

it('Save on an Untitled document goes through Save As and names the document', async () => {
  const disk = fakeDisk({})
  mount(disk.backend)
  await expect.poll(titleBarText).toBe('Untitled')
  runCommand('file.save')
  await expect.poll(titleBarText).toBe('graph.wledgraph')
  expect(readGraphFile(disk.files['graph.wledgraph']).doc.nodes).toHaveLength(defaultNodes)
  expect(readGraphFile(disk.files['graph.wledgraph']).doc.edges).toHaveLength(createDefaultGraph().edges.length)
})

it('Revert asks, then goes back to the last save', async () => {
  const disk = fakeDisk({ 'music.wledgraph': sampleFile })
  mount(disk.backend)
  await expect.poll(titleBarText).toBe('Untitled')
  await openFile(disk, 'music.wledgraph')
  await expect.poll(titleBarText).toBe('music.wledgraph')
  expect(runCommand('file.revert')).toBe(false)

  editFromOutside(sample)
  await expect.poll(titleBarText).toBe('music.wledgraph · Edited')
  runCommand('file.revert')
  await expect.poll(() => dialog()?.textContent).toContain('Revert music.wledgraph?')
  choose('discard')
  await expect.poll(titleBarText).toBe('music.wledgraph')
  expect(config.graph!.nodes[0].position).toEqual(sample.nodes[0].position)
})

it('rejects a file of another version: logged, and the editor keeps its graph and its name', async () => {
  const old = serializeGraphFile({ ...sample, version: 2 })
  const disk = fakeDisk({ 'old.wledgraph': old })
  mount(disk.backend)
  await expect.poll(nodeCount).toBe(defaultNodes)

  await openFile(disk, 'old.wledgraph')
  // the engine logs on its own schedule, so the entry is looked up rather than expected last
  await expect.poll(() => logs.value.find((entry) => entry.message.startsWith('Open failed'))).toMatchObject({
    level: 'error',
    message: 'Open failed: This graph was saved by an older version (2); this app reads version 3.',
  })
  expect(nodeCount()).toBe(defaultNodes)
  expect(titleBarText()).toBe('Untitled')
  expect(recentIds()).toEqual(['file.recent.none'])
})

it('asks before New replaces unsaved work: Cancel keeps it, Save stores it first, Discard drops it', async () => {
  const disk = fakeDisk({ 'music.wledgraph': sampleFile })
  mount(disk.backend)
  await expect.poll(titleBarText).toBe('Untitled')
  await openFile(disk, 'music.wledgraph')
  await expect.poll(titleBarText).toBe('music.wledgraph')
  const edited = editFromOutside(sample)
  await expect.poll(titleBarText).toBe('music.wledgraph · Edited')

  runCommand('file.new')
  await expect.poll(() => dialog()?.textContent).toContain('Save changes to music.wledgraph?')
  expect([...dialog()!.querySelectorAll('button')].map((b) => b.textContent!.trim())).toEqual(['Save', 'Discard', 'Cancel'])
  choose('cancel')
  await expect.poll(dialog).toBeNull()
  expect(titleBarText()).toBe('music.wledgraph · Edited')
  expect(nodeCount()).toBe(sample.nodes.length)

  runCommand('file.new')
  await expect.poll(() => !!dialog()).toBe(true)
  choose('save')
  await expect.poll(titleBarText).toBe('Untitled')
  await expect.poll(nodeCount).toBe(defaultNodes)
  expect(readGraphFile(disk.files['music.wledgraph']).doc.nodes[0].position).toEqual(edited.nodes[0].position)

  editFromOutside(createDefaultGraph())
  await expect.poll(titleBarText).toBe('Untitled · Edited')
  await openFile(disk, 'music.wledgraph')
  await expect.poll(() => !!dialog()).toBe(true)
  choose('discard')
  await expect.poll(titleBarText).toBe('music.wledgraph')
  expect(Object.keys(disk.files)).toEqual(['music.wledgraph'])
})

it('lists files it can reopen under Open Recent, newest first, and reopens one', async () => {
  const disk = fakeDisk({ 'music.wledgraph': sampleFile })
  mount(disk.backend)
  await expect.poll(titleBarText).toBe('Untitled')
  expect(recentIds()).toEqual(['file.recent.none'])
  expect(runCommand('file.recent.none')).toBe(false)

  await openFile(disk, 'music.wledgraph')
  await expect.poll(titleBarText).toBe('music.wledgraph')
  runCommand('file.saveAs')
  await expect.poll(recentIds).toEqual(['file.recent.music.wledgraph'])
  runCommand('file.new')
  await expect.poll(titleBarText).toBe('Untitled')
  runCommand('file.save')
  await expect.poll(recentIds).toEqual(['file.recent.graph.wledgraph', 'file.recent.music.wledgraph'])

  expect(runCommand('file.recent.music.wledgraph')).toBe(true)
  await expect.poll(titleBarText).toBe('music.wledgraph')
  await expect.poll(nodeCount).toBe(sample.nodes.length)
  expect(recentIds()).toEqual(['file.recent.music.wledgraph', 'file.recent.graph.wledgraph'])
})

it('offers no recent files when the backend cannot reopen one', async () => {
  const { reopen: _, ...backend } = fakeDisk({}).backend
  mount(backend)
  await expect.poll(titleBarText).toBe('Untitled')
  runCommand('file.save')
  await expect.poll(titleBarText).toBe('graph.wledgraph')
  expect(recentIds()).toEqual(['file.recent.none'])
})

it('guards the unload only while there is unsaved work', async () => {
  mount(fakeDisk({}).backend)
  await expect.poll(titleBarText).toBe('Untitled')
  const unload = () => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }
  expect(unload()).toBe(false)
  editFromOutside(createDefaultGraph())
  await expect.poll(titleBarText).toBe('Untitled · Edited')
  expect(unload()).toBe(true)
})

it('a closing window asks about unsaved work: Cancel keeps it open, Save lets it close, and the preference switches the question off', async () => {
  const disk = fakeDisk({})
  mount(disk.backend)
  await expect.poll(titleBarText).toBe('Untitled')
  const graphDocument = activeGraphDocument.value!
  expect(await graphDocument.settleBeforeClose()).toBe(true)
  expect(dialog()).toBeNull()

  editFromOutside(createDefaultGraph())
  await expect.poll(titleBarText).toBe('Untitled · Edited')
  const cancelled = graphDocument.settleBeforeClose()
  await expect.poll(() => dialog()?.textContent).toContain('Save changes to Untitled?')
  // a second close request while the question is up does not replace it, and does not close
  expect(await graphDocument.settleBeforeClose()).toBe(false)
  choose('cancel')
  expect(await cancelled).toBe(false)

  preferences.confirmClose = false
  expect(await graphDocument.settleBeforeClose()).toBe(true)
  expect(dialog()).toBeNull()
  preferences.confirmClose = true

  const saved = graphDocument.settleBeforeClose()
  await expect.poll(() => dialog()).not.toBeNull()
  choose('save')
  expect(await saved).toBe(true)
  expect(disk.files['graph.wledgraph']).toBeDefined()
})

async function sessionWithUnsavedWork() {
  mount(fakeDisk({}).backend)
  await expect.poll(titleBarText).toBe('Untitled')
  const edited = editFromOutside(createDefaultGraph())
  await expect.poll(() => localStorage.getItem('wledtoy:graph:recovery'), { timeout: 3000 }).not.toBeNull()
  unmount!()
  return edited
}

it('after a reload with unsaved work, Recover brings the autosaved graph back even when the working copy is gone', async () => {
  const edited = await sessionWithUnsavedWork()
  config.graph = null

  mount(fakeDisk({}).backend)
  await expect.poll(() => dialog()?.textContent).toContain('Recover unsaved graph?')
  expect([...dialog()!.querySelectorAll('button')].map((b) => b.textContent!.trim())).toEqual(['Recover', 'Discard'])
  choose('recover')
  await expect.poll(() => config.graph?.nodes[0].position).toEqual(edited.nodes[0].position)
  expect(dialog()).toBeNull()
})

it('after a reload with unsaved work, Discard drops the autosaved graph and starts a new one', async () => {
  const edited = await sessionWithUnsavedWork()
  expect(config.graph!.nodes[0].position).toEqual(edited.nodes[0].position)

  mount(fakeDisk({}).backend)
  await expect.poll(() => !!dialog()).toBe(true)
  choose('discard')
  await expect.poll(() => config.graph?.nodes[0].position).toEqual(createDefaultGraph().nodes[0].position)
  expect(localStorage.getItem('wledtoy:graph:recovery')).toBeNull()
  expect(titleBarText()).toBe('Untitled')
})
