import { afterEach, describe, expect, it, vi } from 'vitest'
import { SHADER_FILES, createDownloadBackend, createFileSystemAccessBackend, createTauriBackend, type FileBackend } from './file-backends'
import type { FileFilter, TauriFiles } from './tauri-files'

afterEach(() => {
  vi.unstubAllGlobals()
})

interface BackendHarness {
  backend: FileBackend
  read(): Promise<string>
}

function fileSystemAccessHarness(): BackendHarness {
  let fileText = 'seed content'
  const fakeHandle = (name: string) =>
    ({
      kind: 'file',
      name,
      getFile: async () => ({ text: async () => fileText }),
      createWritable: async () => ({
        write: async (chunk: string) => {
          fileText = chunk
        },
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
    createObjectURL: (blob: Blob) => {
      lastBlob = blob
      return 'blob:fake'
    },
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
      showOpenFilePicker: async () => {
        throw new DOMException('cancelled', 'AbortError')
      },
      showSaveFilePicker: async () => {
        throw new DOMException('cancelled', 'AbortError')
      },
    })
    const backend = createFileSystemAccessBackend()
    expect(await backend.open('.test')).toBeNull()
    expect(await backend.saveAs('x', 'x.test', '.test')).toBeNull()
  })
})

/** The Tauri dialog and fs plugins over a disk in memory: `pick` is the path the next dialog returns, null when the user cancels it. */
function fakeTauriFiles(disk: Record<string, string>) {
  const dialogs: Array<{ kind: 'open' | 'save'; defaultPath?: string; filter: FileFilter }> = []
  const state = { pick: null as string | null }
  const files: TauriFiles = {
    pickOpen: async (filter) => {
      dialogs.push({ kind: 'open', filter })
      return state.pick
    },
    pickSave: async (defaultPath, filter) => {
      dialogs.push({ kind: 'save', defaultPath, filter })
      return state.pick
    },
    readTextFile: async (path) => {
      if (!(path in disk)) throw new Error(`forbidden path: ${path}`)
      return disk[path]
    },
    writeTextFile: async (path, text) => {
      disk[path] = text
    },
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

  it('reopens by path without a dialog, and a path that is gone or out of scope rejects as gone with the reason', async () => {
    const fake = fakeTauriFiles({ '/Users/me/a.wledgraph': 'one' })
    const backend = createTauriBackend(fake.load)
    expect(await backend.reopen!('/Users/me/a.wledgraph')).toEqual({ handle: { name: 'a.wledgraph', path: '/Users/me/a.wledgraph' }, text: 'one' })
    await expect(backend.reopen!('/Users/me/gone.wledgraph')).rejects.toMatchObject({
      code: 'file-gone',
      cause: new Error('forbidden path: /Users/me/gone.wledgraph'),
    })
    expect(fake.dialogs).toEqual([])
  })
})
