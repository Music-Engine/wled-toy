import { nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SHADER_FILES, createDocumentStore, createDownloadBackend, createFileSystemAccessBackend, createTauriBackend,
  type DocumentStoreOptions, type FileBackend,
} from './documents'
import type { FileFilter, TauriFiles } from './tauri-files'

interface Doc {
  text: string
}

function fakeLocalStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeLocalStorage())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const noopBackend: FileBackend = {
  open: async () => null,
  save: async () => undefined,
  saveAs: async (text, name) => ({ handle: { name }, text }),
}

const docOptions = (overrides: Partial<DocumentStoreOptions<Doc>>): DocumentStoreOptions<Doc> => ({
  kind: 'test',
  extension: '.test',
  backend: noopBackend,
  serialize: (doc) => doc.text,
  parse: (text) => ({ text }),
  createNew: () => ({ text: '' }),
  getSnapshot: () => ({ text: '' }),
  onLoad: () => undefined,
  ...overrides,
})

describe('createDocumentStore', () => {
  it('is dirty exactly when the snapshot differs from the last save, and clears on save, saveAs, and revert', async () => {
    const state = reactive<Doc>({ text: 'a' })
    const saved: string[] = []
    const backend: FileBackend = {
      open: async () => null,
      save: async (_handle, text) => { saved.push(text) },
      saveAs: async (text, name) => { saved.push(text); return { handle: { name }, text } },
    }
    const store = createDocumentStore(docOptions({
      backend, getSnapshot: () => ({ text: state.text }), onLoad: (d) => { state.text = d.text },
    }))

    expect(store.dirty.value).toBe(false)
    state.text = 'b'
    expect(store.dirty.value).toBe(true)

    await store.save() // no file yet, falls through to saveAs
    expect(saved).toEqual(['b'])
    expect(store.dirty.value).toBe(false)
    expect(store.fileName.value).toBe('test.test')

    state.text = 'c'
    expect(store.dirty.value).toBe(true)
    await store.save()
    expect(saved).toEqual(['b', 'c'])
    expect(store.dirty.value).toBe(false)

    state.text = 'd'
    store.revert()
    expect(state.text).toBe('c')
    expect(store.dirty.value).toBe(false)
  })

  it('newDocument loads a fresh doc, clears the file handle, and starts clean', () => {
    const state = reactive<Doc>({ text: 'loaded' })
    const store = createDocumentStore(docOptions({
      createNew: () => ({ text: 'fresh' }), getSnapshot: () => ({ text: state.text }), onLoad: (d) => { state.text = d.text },
    }))
    store.newDocument()
    expect(state.text).toBe('fresh')
    expect(store.fileName.value).toBeNull()
    expect(store.dirty.value).toBe(false)
  })

  it('openText takes the name without a handle: Save asks where like Save As, the recent list leaves it out, and bad text changes nothing', async () => {
    const state = reactive<Doc>({ text: 'a' })
    const calls: string[] = []
    const backend: FileBackend = {
      open: async () => null,
      save: async () => { calls.push('save') },
      saveAs: async (text, name) => { calls.push(`saveAs ${name}`); return { handle: { name: 'chosen.test' }, text } },
      reopen: async () => null,
    }
    const store = createDocumentStore(docOptions({
      backend,
      getSnapshot: () => ({ text: state.text }),
      onLoad: (d) => { state.text = d.text },
      parse: (text) => { if (text === 'broken') throw new Error('unreadable'); return { text } },
    }))

    store.openText('dropped.test', 'from a drop')
    expect(state.text).toBe('from a drop')
    expect(store.fileName.value).toBe('dropped.test')
    expect(store.dirty.value).toBe(false)
    expect(store.recentFiles.value).toEqual([])

    expect(() => store.openText('bad.test', 'broken')).toThrow('unreadable')
    expect(store.fileName.value).toBe('dropped.test')
    expect(state.text).toBe('from a drop')

    state.text = 'edited'
    await store.save()
    expect(calls).toEqual(['saveAs dropped.test'])
    expect(store.fileName.value).toBe('chosen.test')
    expect(store.recentFiles.value.map((f) => f.name)).toEqual(['chosen.test'])

    store.openText('again.test', 'x')
    store.newDocument()
    expect(store.fileName.value).toBeNull()
  })

  it('recovers an autosaved working copy in a fresh controller instance from the same storage key', async () => {
    vi.useFakeTimers()
    const state = reactive({ text: 'unsaved work' })
    const makeOptions = (onLoad: (d: Doc) => void) => docOptions({ getSnapshot: () => ({ text: state.text }), onLoad })

    const first = createDocumentStore(makeOptions((d) => { state.text = d.text }))
    expect(first.hasRecovery.value).toBe(false)

    state.text = 'changed while editing'
    await nextTick()
    vi.advanceTimersByTime(1000)
    expect(localStorage.getItem('wledtoy:test:recovery')).toBe('changed while editing')

    const loaded: Doc[] = []
    const second = createDocumentStore(makeOptions((d) => loaded.push(d)))
    expect(second.hasRecovery.value).toBe(true)

    second.recoverFromAutosave()
    expect(loaded).toEqual([{ text: 'changed while editing' }])
    expect(second.hasRecovery.value).toBe(false)
  })

  it('reads the autosave delay on every change, and null keeps no recovery copy at all', async () => {
    vi.useFakeTimers()
    const state = reactive({ text: 'a' })
    let delay: number | null = 3000
    createDocumentStore(docOptions({ getSnapshot: () => ({ text: state.text }), onLoad: () => undefined, autosaveDebounceMs: () => delay }))

    state.text = 'b'
    await nextTick()
    vi.advanceTimersByTime(2000)
    expect(localStorage.getItem('wledtoy:test:recovery')).toBeNull()
    vi.advanceTimersByTime(1000)
    expect(localStorage.getItem('wledtoy:test:recovery')).toBe('b')

    delay = null
    state.text = 'c'
    await nextTick()
    vi.advanceTimersByTime(10000)
    expect(localStorage.getItem('wledtoy:test:recovery')).toBeNull()
  })

  it('drops the recovery snapshot once the working copy matches the last save again', async () => {
    vi.useFakeTimers()
    const state = reactive({ text: 'a' })
    createDocumentStore(docOptions({ getSnapshot: () => ({ text: state.text }) }))

    state.text = 'b'
    await nextTick()
    vi.advanceTimersByTime(1000)
    expect(localStorage.getItem('wledtoy:test:recovery')).toBe('b')

    state.text = 'a'
    await nextTick()
    vi.advanceTimersByTime(1000)
    expect(localStorage.getItem('wledtoy:test:recovery')).toBeNull()
  })
})

interface BackendHarness {
  backend: FileBackend
  read(): Promise<string>
}

function fileSystemAccessHarness(): BackendHarness {
  let fileText = 'seed content'
  const fakeHandle = (name: string) => ({
    kind: 'file',
    name,
    getFile: async () => ({ text: async () => fileText }),
    createWritable: async () => ({
      write: async (chunk: string) => { fileText = chunk },
      close: async () => undefined,
    }),
  }) as unknown as FileSystemFileHandle

  vi.stubGlobal('window', {
    showOpenFilePicker: async () => [fakeHandle('seed.test')],
    showSaveFilePicker: async ({ suggestedName }: { suggestedName: string }) => fakeHandle(suggestedName),
  })

  return { backend: createFileSystemAccessBackend(), read: async () => fileText }
}

function downloadHarness(): BackendHarness {
  let fileText = 'seed content'
  let lastBlob: Blob | null = null
  const fakeFile = { name: 'seed.test', text: async () => fileText } as unknown as File

  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag === 'input') {
        const input = { onchange: null as (() => void) | null, click: () => input.onchange?.(), remove: () => undefined }
        Object.defineProperty(input, 'files', { get: () => [fakeFile] })
        return input
      }
      return { click: () => undefined }
    },
    body: { append: () => undefined },
  })
  vi.stubGlobal('URL', {
    createObjectURL: (blob: Blob) => { lastBlob = blob; return 'blob:fake' },
    revokeObjectURL: () => undefined,
  })

  return {
    backend: createDownloadBackend(),
    read: async () => (lastBlob ? await (lastBlob as Blob).text() : fileText),
  }
}

describe.each([
  ['File System Access API backend', fileSystemAccessHarness],
  ['download fallback backend', downloadHarness],
])('%s', (_label, makeHarness) => {
  it('opens, saves, and saves as', async () => {
    const { backend, read } = makeHarness()

    const opened = await backend.open('.test')
    expect(opened?.text).toBe('seed content')
    expect(opened?.handle.name).toBe('seed.test')

    await backend.save(opened!.handle, 'updated content')
    expect(await read()).toBe('updated content')

    const savedAs = await backend.saveAs('fresh content', 'renamed.test', '.test')
    expect(savedAs?.handle.name).toBe('renamed.test')
    expect(await read()).toBe('fresh content')
  })
})

describe('createFileSystemAccessBackend', () => {
  it('returns null instead of throwing when the user cancels the picker', async () => {
    vi.stubGlobal('window', {
      showOpenFilePicker: async () => { throw new DOMException('cancelled', 'AbortError') },
      showSaveFilePicker: async () => { throw new DOMException('cancelled', 'AbortError') },
    })
    const backend = createFileSystemAccessBackend()
    expect(await backend.open('.test')).toBeNull()
    expect(await backend.saveAs('x', 'x.test', '.test')).toBeNull()
  })
})

describe('open recent', () => {
  const reopeningBackend = (files: Record<string, string>): FileBackend => ({
    ...noopBackend,
    open: async () => ({ handle: { name: 'first.test' }, text: files['first.test'] }),
    reopen: async (name) => (name in files ? { handle: { name }, text: files[name] } : null),
  })

  it('reopens a listed file through the backend and moves it to the top of the list', async () => {
    const loaded: Doc[] = []
    const store = createDocumentStore(docOptions({ backend: reopeningBackend({ 'first.test': 'one', 'second.test': 'two' }), onLoad: (d) => loaded.push(d) }))
    expect(store.canReopenRecent).toBe(true)
    await store.open()
    await store.openRecent('second.test')
    expect(store.recentFiles.value.map((f) => f.name)).toEqual(['second.test', 'first.test'])

    await store.openRecent('first.test')
    expect(loaded).toEqual([{ text: 'one' }, { text: 'two' }, { text: 'one' }])
    expect(store.fileName.value).toBe('first.test')
    expect(store.recentFiles.value.map((f) => f.name)).toEqual(['first.test', 'second.test'])
    expect(JSON.parse(localStorage.getItem('wledtoy:test:recent')!).map((f: { name: string }) => f.name)).toEqual(['first.test', 'second.test'])
  })

  it('drops an entry the backend can no longer open, says so, and leaves the document alone', async () => {
    const loaded: Doc[] = []
    const files: Record<string, string> = { 'first.test': 'one' }
    const store = createDocumentStore(docOptions({ backend: reopeningBackend(files), onLoad: (d) => loaded.push(d) }))
    await store.open()
    delete files['first.test']

    await expect(store.openRecent('first.test')).rejects.toThrow('first.test can no longer be opened')
    expect(loaded).toHaveLength(1)
    expect(store.fileName.value).toBe('first.test')
    expect(store.recentFiles.value).toEqual([])
    expect(localStorage.getItem('wledtoy:test:recent')).toBe('[]')
  })

  it('a file that fails to parse is not loaded and does not become the current file', async () => {
    const loaded: Doc[] = []
    const store = createDocumentStore(docOptions({
      backend: reopeningBackend({ 'first.test': 'one' }),
      parse: () => { throw new Error('unreadable') },
      onLoad: (d) => loaded.push(d),
    }))
    await expect(store.openRecent('first.test')).rejects.toThrow('unreadable')
    expect(loaded).toEqual([])
    expect(store.fileName.value).toBeNull()
  })

  it('a backend without reopen cannot offer recent files', async () => {
    const store = createDocumentStore(docOptions({}))
    expect(store.canReopenRecent).toBe(false)
    await expect(store.openRecent('anything.test')).rejects.toThrow('can no longer be opened')
  })
})

/** The Tauri dialog and fs plugins over a disk in memory: `pick` is the path the next dialog returns, null when the user cancels it. */
function fakeTauriFiles(disk: Record<string, string>) {
  const dialogs: Array<{ kind: 'open' | 'save'; defaultPath?: string; filter: FileFilter }> = []
  const state = { pick: null as string | null }
  const files: TauriFiles = {
    pickOpen: async (filter) => { dialogs.push({ kind: 'open', filter }); return state.pick },
    pickSave: async (defaultPath, filter) => { dialogs.push({ kind: 'save', defaultPath, filter }); return state.pick },
    readTextFile: async (path) => {
      if (!(path in disk)) throw new Error(`forbidden path: ${path}`)
      return disk[path]
    },
    writeTextFile: async (path, text) => { disk[path] = text },
  }
  return { state, dialogs, load: async () => files }
}

describe('createTauriBackend', () => {
  it('opens the picked path, named after the file, through a dialog that filters on the extension', async () => {
    const fake = fakeTauriFiles({ '/Users/me/shows/club night.wledgraph': 'one' })
    fake.state.pick = '/Users/me/shows/club night.wledgraph'
    const opened = await createTauriBackend(fake.load).open('.wledgraph')
    expect(opened).toEqual({ handle: { name: 'club night.wledgraph', path: '/Users/me/shows/club night.wledgraph' }, text: 'one' })
    expect(fake.dialogs).toEqual([{ kind: 'open', filter: { name: 'WLEDtoy graph', extensions: ['wledgraph'] } }])
  })

  it('a backend for shader files names them in its dialogs: Open offers every extension, Save As the one it writes', async () => {
    const fake = fakeTauriFiles({ '/Users/me/fire.frag': 'void mainImage' })
    fake.state.pick = '/Users/me/fire.frag'
    const backend = createTauriBackend(fake.load, SHADER_FILES)
    expect((await backend.open('.glsl', ['.frag', '.fs']))?.handle.name).toBe('fire.frag')
    await backend.saveAs('text', 'fire.glsl', '.glsl')
    expect(fake.dialogs).toEqual([
      { kind: 'open', filter: { name: 'GLSL shader', extensions: ['glsl', 'frag', 'fs'] } },
      { kind: 'save', defaultPath: 'fire.glsl', filter: { name: 'GLSL shader', extensions: ['glsl'] } },
    ])
  })

  it('save writes to the path of the handle without a dialog', async () => {
    const disk: Record<string, string> = { '/Users/me/a.wledgraph': 'one' }
    const fake = fakeTauriFiles(disk)
    await createTauriBackend(fake.load).save({ name: 'a.wledgraph', path: '/Users/me/a.wledgraph' }, 'two')
    expect(disk).toEqual({ '/Users/me/a.wledgraph': 'two' })
    expect(fake.dialogs).toEqual([])
  })

  it('saveAs suggests the name, writes where the user chose, and the handle follows the chosen path', async () => {
    const disk: Record<string, string> = {}
    const fake = fakeTauriFiles(disk)
    fake.state.pick = 'C:\\shows\\renamed.wledgraph'
    const saved = await createTauriBackend(fake.load).saveAs('text', 'graph.wledgraph', '.wledgraph')
    expect(saved?.handle).toEqual({ name: 'renamed.wledgraph', path: 'C:\\shows\\renamed.wledgraph' })
    expect(disk).toEqual({ 'C:\\shows\\renamed.wledgraph': 'text' })
    expect(fake.dialogs).toEqual([{ kind: 'save', defaultPath: 'graph.wledgraph', filter: { name: 'WLEDtoy graph', extensions: ['wledgraph'] } }])
  })

  it('a cancelled dialog is null, and nothing is read or written', async () => {
    const disk: Record<string, string> = {}
    const backend = createTauriBackend(fakeTauriFiles(disk).load)
    expect(await backend.open('.wledgraph')).toBeNull()
    expect(await backend.saveAs('text', 'graph.wledgraph', '.wledgraph')).toBeNull()
    expect(disk).toEqual({})
  })

  it('reopens by path without a dialog, and a path that is gone or out of scope is null', async () => {
    const fake = fakeTauriFiles({ '/Users/me/a.wledgraph': 'one' })
    const backend = createTauriBackend(fake.load)
    expect(await backend.reopen!('/Users/me/a.wledgraph')).toEqual({ handle: { name: 'a.wledgraph', path: '/Users/me/a.wledgraph' }, text: 'one' })
    expect(await backend.reopen!('/Users/me/gone.wledgraph')).toBeNull()
    expect(fake.dialogs).toEqual([])
  })

  it('the recent list keeps the path, tells two files of one name apart, and reopens by path in a later session', async () => {
    const disk = { '/a/show.test': 'from a', '/b/show.test': 'from b' }
    const fake = fakeTauriFiles(disk)
    const state = reactive<Doc>({ text: '' })
    const options = docOptions({ backend: createTauriBackend(fake.load), getSnapshot: () => ({ text: state.text }), onLoad: (d) => { state.text = d.text } })
    const store = createDocumentStore(options)
    for (const path of ['/a/show.test', '/b/show.test', '/a/show.test']) {
      fake.state.pick = path
      await store.open()
    }
    expect(store.recentFiles.value.map(({ name, path }) => ({ name, path }))).toEqual([{ name: 'show.test', path: '/a/show.test' }, { name: 'show.test', path: '/b/show.test' }])

    const later = createDocumentStore(options)
    expect(later.canReopenRecent).toBe(true)
    await later.openRecent('/b/show.test')
    expect(state.text).toBe('from b')
    expect(later.fileName.value).toBe('show.test')
    expect(later.recentFiles.value.map((file) => file.path)).toEqual(['/b/show.test', '/a/show.test'])

    state.text = 'edited'
    await later.save()
    expect(disk['/b/show.test']).toBe('edited')
  })
})
