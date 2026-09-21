import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { baseName, loadTauriFiles, type TauriFiles } from './tauri-files'

declare global {
  interface Window {
    showOpenFilePicker?(options: { types: { description: string; accept: Record<string, string[]> }[] }): Promise<FileSystemFileHandle[]>
    showSaveFilePicker?(options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }): Promise<FileSystemFileHandle>
  }
  interface FileSystemHandle {
    queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
    requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  }
}

export interface FileHandle {
  name: string
  /** Where the file lives, from a backend that knows; the recent list then tells files apart by it, and `reopen` gets it. */
  path?: string
}

export interface OpenedFile<H extends FileHandle = FileHandle> {
  handle: H
  text: string
}

/**
 * How a document controller reads and writes files. `open`/`saveAs` return null when the user cancels.
 * `createTauriBackend` is a third instance of this interface, not a change to its callers.
 */
export interface FileBackend<H extends FileHandle = FileHandle> {
  /** The dialog offers `extension` and whatever `alsoAccept` lists; Save As writes `extension` only. */
  open(extension: string, alsoAccept?: string[]): Promise<OpenedFile<H> | null>
  save(handle: H, text: string): Promise<void>
  saveAs(text: string, suggestedName: string, extension: string): Promise<OpenedFile<H> | null>
  /** Opens a file this backend opened or saved before, by its handle's path or else its name, without a dialog. Null when it cannot. A backend that never can leaves this out. */
  reopen?(id: string): Promise<OpenedFile<H> | null>
}

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError'

/** What the dialogs of a backend call its files, and the media type a browser gives them. */
export interface FileKind {
  description: string
  mime: string
}

const GRAPH_FILES: FileKind = { description: 'WLEDtoy graph', mime: 'application/json' }
export const SHADER_FILES: FileKind = { description: 'GLSL shader', mime: 'text/plain' }

const pickerTypes = (kind: FileKind, extensions: string[]) => [{ description: kind.description, accept: { [kind.mime]: extensions } }]

interface FsAccessHandle extends FileHandle {
  handle: FileSystemFileHandle
}

// A file handle is structured-cloneable but not a string, so the handles behind the recent list live in IndexedDB
function handleStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('wledtoy-documents', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('handles')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).then((db) => new Promise<T>((resolve, reject) => {
    const request = run(db.transaction('handles', mode).objectStore('handles'))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).finally(() => db.close()))
}

// without IndexedDB (a private window) the file still opens and saves; it only cannot be reopened from the recent list
const rememberHandle = (handle: FileSystemFileHandle) => handleStore('readwrite', (store) => store.put(handle, handle.name)).catch(() => undefined)

/** Reads and writes real files on disk, with the OS's own open/save dialogs. */
export function createFileSystemAccessBackend(kind: FileKind = GRAPH_FILES): FileBackend<FsAccessHandle> {
  return {
    async reopen(name) {
      const handle = await handleStore<FileSystemFileHandle | undefined>('readonly', (store) => store.get(name)).catch(() => undefined)
      if (!handle) return null
      // a handle from an earlier session has lost its permission; asking again needs the click that ran the command
      const permission = (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted'
      if (permission !== 'granted' && (await handle.requestPermission?.({ mode: 'read' })) !== 'granted') return null
      try {
        return { handle: { name: handle.name, handle }, text: await (await handle.getFile()).text() }
      } catch {
        return null
      }
    },
    async open(extension, alsoAccept = []) {
      let handles: FileSystemFileHandle[]
      try {
        handles = await window.showOpenFilePicker!({ types: pickerTypes(kind, [extension, ...alsoAccept]) })
      } catch (err) {
        if (isAbort(err)) return null
        throw err
      }
      const handle = handles[0]
      const text = await (await handle.getFile()).text()
      await rememberHandle(handle)
      return { handle: { name: handle.name, handle }, text }
    },
    async save(h, text) {
      const writable = await h.handle.createWritable()
      await writable.write(text)
      await writable.close()
    },
    async saveAs(text, suggestedName, extension) {
      let handle: FileSystemFileHandle
      try {
        handle = await window.showSaveFilePicker!({ suggestedName, types: pickerTypes(kind, [extension]) })
      } catch (err) {
        if (isAbort(err)) return null
        throw err
      }
      const writable = await handle.createWritable()
      await writable.write(text)
      await writable.close()
      await rememberHandle(handle)
      return { handle: { name: handle.name, handle }, text }
    },
  }
}

interface DownloadHandle extends FileHandle {
  text: string
}

function downloadText(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}

/** No File System Access API: saving downloads a file and opening picks one through a plain file input. */
export function createDownloadBackend(kind: FileKind = GRAPH_FILES): FileBackend<DownloadHandle> {
  return {
    open(extension, alsoAccept = []) {
      return new Promise((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = [extension, ...alsoAccept].join(',')
        input.onchange = () => {
          const file = input.files?.[0]
          if (!file) {
            resolve(null)
            return
          }
          file.text().then((text) => resolve({ handle: { name: file.name, text }, text }))
        }
        input.click()
      })
    },
    async save(handle, text) {
      handle.text = text
      downloadText(handle.name, text, kind.mime)
    },
    saveAs(text, suggestedName) {
      downloadText(suggestedName, text, kind.mime)
      return Promise.resolve({ handle: { name: suggestedName, text }, text })
    },
  }
}

/** The File System Access API when the browser has it, the download/upload fallback otherwise. */
export function createBrowserBackend(kind: FileKind = GRAPH_FILES): FileBackend {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function'
    ? createFileSystemAccessBackend(kind)
    : createDownloadBackend(kind)
}

interface TauriHandle extends FileHandle {
  path: string
}

/** Native dialogs and real paths. The path is the whole handle, so a recent file reopens in a later session as well. */
export function createTauriBackend(load: () => Promise<TauriFiles> = loadTauriFiles, kind: FileKind = GRAPH_FILES): FileBackend<TauriHandle> {
  const filter = (extensions: string[]) => ({ name: kind.description, extensions: extensions.map((extension) => extension.replace(/^\./, '')) })
  return {
    async reopen(path) {
      try {
        return { handle: { name: baseName(path), path }, text: await (await load()).readTextFile(path) }
      } catch {
        return null
      }
    },
    async open(extension, alsoAccept = []) {
      const files = await load()
      const path = await files.pickOpen(filter([extension, ...alsoAccept]))
      return path === null ? null : { handle: { name: baseName(path), path }, text: await files.readTextFile(path) }
    },
    async save(handle, text) {
      await (await load()).writeTextFile(handle.path, text)
    },
    async saveAs(text, suggestedName, extension) {
      const files = await load()
      const path = await files.pickSave(suggestedName, filter([extension]))
      if (path === null) return null
      await files.writeTextFile(path, text)
      return { handle: { name: baseName(path), path }, text }
    },
  }
}

export interface RecentFile {
  name: string
  openedAt: string
  path?: string
}

/** What `openRecent` takes: two files of one name in different folders are two entries. */
export const recentId = (file: { name: string; path?: string }) => file.path ?? file.name

export interface DocumentStoreOptions<T> {
  /** Namespaces this document's localStorage keys, e.g. "graph"; also lets a future document kind share this controller. */
  kind: string
  extension: string
  /** Other extensions Open accepts; Save As always writes `extension`. */
  openExtensions?: string[]
  backend: FileBackend
  serialize: (doc: T) => string
  parse: (text: string) => T
  createNew: () => T
  /** Reads the current document out of the editor; called on every save and dirty check. */
  getSnapshot: () => T
  /** Pushes a document (new, opened, reverted, or recovered) into the editor. */
  onLoad: (doc: T) => void
  /** Delay before the recovery copy is written; a function is read on every change, and null switches recovery off. */
  autosaveDebounceMs?: number | (() => number | null)
}

export interface DocumentStore<T> {
  readonly fileName: ComputedRef<string | null>
  readonly dirty: ComputedRef<boolean>
  readonly recentFiles: Ref<RecentFile[]>
  readonly hasRecovery: Ref<boolean>
  /** False when the backend cannot reopen a file by name, so a recent list has nothing to offer. */
  readonly canReopenRecent: boolean
  newDocument(): void
  open(): Promise<void>
  /** Opens text that came without a file to write back to (a file dropped on the window). The document takes the name, Save asks where to put it as Save As does, and the recent list leaves it out because nothing could reopen it. */
  openText(name: string, text: string): void
  /** Opens an entry of `recentFiles` by its `recentId`. An entry the backend can no longer open is dropped from the list and the call throws. */
  openRecent(id: string): Promise<void>
  save(): Promise<void>
  saveAs(): Promise<void>
  revert(): void
  recoverFromAutosave(): void
  discardRecovery(): void
}

function loadRecentFiles(key: string): RecentFile[] {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as RecentFile[]) : []
  } catch {
    return []
  }
}

const RECENT_FILES_LIMIT = 10

export function createDocumentStore<T>(options: DocumentStoreOptions<T>): DocumentStore<T> {
  const { kind, extension, openExtensions, backend, serialize, parse, createNew, getSnapshot, onLoad, autosaveDebounceMs = 800 } = options
  const recentKey = `wledtoy:${kind}:recent`
  const recoveryKey = `wledtoy:${kind}:recovery`

  const fileHandle = ref<FileHandle | null>(null)
  const handlelessName = ref<string | null>(null)
  const lastSavedText = ref(serialize(getSnapshot()))
  const recentFiles = ref<RecentFile[]>(loadRecentFiles(recentKey))
  const hasRecovery = ref(localStorage.getItem(recoveryKey) !== null)

  const fileName = computed(() => fileHandle.value?.name ?? handlelessName.value)

  // The dirty flag is read on every render of the title bar and of the window title, and serializing a large document
  // for each of those reads is most of what an edit costs. One serialization per snapshot serves them all.
  let serialized: { snapshot: T; text: string } | null = null
  function snapshotText() {
    const snapshot = getSnapshot()
    if (!serialized || serialized.snapshot !== snapshot) serialized = { snapshot, text: serialize(snapshot) }
    return serialized.text
  }
  const dirty = computed(() => snapshotText() !== lastSavedText.value)

  function clearRecovery() {
    hasRecovery.value = false
    localStorage.removeItem(recoveryKey)
  }

  function addRecentFile({ name, path }: FileHandle) {
    const next = [{ name, openedAt: new Date().toISOString(), ...(path ? { path } : {}) }, ...recentFiles.value.filter((f) => recentId(f) !== (path ?? name))].slice(0, RECENT_FILES_LIMIT)
    recentFiles.value = next
    localStorage.setItem(recentKey, JSON.stringify(next))
  }

  let autosaveTimer: ReturnType<typeof setTimeout> | undefined
  // No deep option: `getSnapshot` reports a change by returning a different value, and walking a whole document on
  // every edit is what this watcher is here to avoid.
  watch(getSnapshot, () => {
    clearTimeout(autosaveTimer)
    const delay = typeof autosaveDebounceMs === 'function' ? autosaveDebounceMs() : autosaveDebounceMs
    if (delay === null) return clearRecovery()
    autosaveTimer = setTimeout(() => {
      if (dirty.value) localStorage.setItem(recoveryKey, serialize(getSnapshot()))
      else clearRecovery()
    }, delay)
  })

  function load(opened: OpenedFile) {
    const doc = parse(opened.text)
    fileHandle.value = opened.handle
    handlelessName.value = null
    onLoad(doc)
    lastSavedText.value = serialize(doc)
    addRecentFile(opened.handle)
    clearRecovery()
  }

  async function saveAs() {
    const text = serialize(getSnapshot())
    const suggested = fileName.value ?? `${kind}${extension}`
    const saved = await backend.saveAs(text, suggested, extension)
    if (!saved) return
    fileHandle.value = saved.handle
    handlelessName.value = null
    lastSavedText.value = text
    addRecentFile(saved.handle)
    clearRecovery()
  }

  return {
    fileName,
    dirty,
    recentFiles,
    hasRecovery,
    canReopenRecent: !!backend.reopen,
    newDocument() {
      fileHandle.value = null
      handlelessName.value = null
      const doc = createNew()
      onLoad(doc)
      lastSavedText.value = serialize(doc)
      clearRecovery()
    },
    async open() {
      const opened = await backend.open(extension, openExtensions)
      if (opened) load(opened)
    },
    openText(name, text) {
      const doc = parse(text)
      fileHandle.value = null
      handlelessName.value = name
      onLoad(doc)
      lastSavedText.value = serialize(doc)
      clearRecovery()
    },
    async openRecent(id) {
      const opened = await backend.reopen?.(id)
      if (opened) {
        load(opened)
        return
      }
      recentFiles.value = recentFiles.value.filter((f) => recentId(f) !== id)
      localStorage.setItem(recentKey, JSON.stringify(recentFiles.value))
      throw new Error(`${baseName(id)} can no longer be opened from the recent list. Use Open instead.`)
    },
    async save() {
      if (!fileHandle.value) {
        await saveAs()
        return
      }
      const text = serialize(getSnapshot())
      await backend.save(fileHandle.value, text)
      lastSavedText.value = text
      addRecentFile(fileHandle.value)
      clearRecovery()
    },
    saveAs,
    revert() {
      onLoad(parse(lastSavedText.value))
      clearRecovery()
    },
    recoverFromAutosave() {
      const raw = localStorage.getItem(recoveryKey)
      if (raw === null) return
      onLoad(parse(raw))
      hasRecovery.value = false
    },
    discardRecovery: clearRecovery,
  }
}
