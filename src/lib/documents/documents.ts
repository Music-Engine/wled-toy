import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { baseName } from '@/lib/util/files'
import { loadStored } from '@/lib/app/settings/storage'
import { DocumentError } from './document-error'
import type { FileBackend, FileHandle, OpenedFile } from '@/lib/documents/files/file-backends'

export interface RecentFile {
  name: string
  openedAt: string
  path?: string
}

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
  /** Opens an entry of `recentFiles` by its `recentId`. An entry the backend can no longer open is dropped from the list and the call throws a DocumentError saying why. */
  openRecent(id: string): Promise<void>
  save(): Promise<void>
  saveAs(): Promise<void>
  revert(): void
  recoverFromAutosave(): void
  discardRecovery(): void
}

export function createDocumentStore<T>(options: DocumentStoreOptions<T>): DocumentStore<T> {
  const { kind, extension, openExtensions, backend, serialize, parse, createNew, getSnapshot, onLoad, autosaveDebounceMs = 800 } = options
  const recoveryKey = `wledtoy:${kind}:recovery`

  const fileHandle = ref<FileHandle | null>(null)
  const handlelessName = ref<string | null>(null)
  const lastSavedText = ref(serialize(getSnapshot()))
  const recentFiles = ref<RecentFile[]>(storedRecentFiles(kind))
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
    localStorage.setItem(recentKey(kind), JSON.stringify(next))
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
      let opened: OpenedFile
      try {
        if (!backend.reopen) throw new DocumentError('file-gone', 'this browser cannot reopen files')
        opened = await backend.reopen(id)
      } catch (error) {
        if (!(error instanceof DocumentError)) throw error
        recentFiles.value = recentFiles.value.filter((f) => recentId(f) !== id)
        localStorage.setItem(recentKey(kind), JSON.stringify(recentFiles.value))
        throw new DocumentError(error.code, `${baseName(id)} can no longer be opened from the recent list: ${error.message}. Use Open instead.`, error.cause)
      }
      load(opened)
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

/** The recent list a document kind stored, for a screen that shows it before that kind's store exists. */
export const storedRecentFiles = (kind: string) => loadStored(recentKey(kind), `your recent ${kind} files`, sanitizeRecentFiles, [])

/** What `openRecent` takes: two files of one name in different folders are two entries. */
export const recentId = (file: { name: string; path?: string }) => file.path ?? file.name

const RECENT_FILES_LIMIT = 10

const recentKey = (kind: string) => `wledtoy:${kind}:recent`

function sanitizeRecentFiles(raw: unknown): RecentFile[] {
  if (!Array.isArray(raw)) throw new DocumentError('bad-recent-list', 'the recent list is not a list')
  return raw as RecentFile[]
}
