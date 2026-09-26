import { loadTauriFiles, type TauriFiles } from './tauri-files'
import { baseName } from '@/lib/util/files'
import { downloadText } from '@/lib/app/download'
import { pickFile } from '@/lib/app/pick-file'
import { report } from '@/lib/app/logs'
import { DocumentError } from './document-error'

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
  /** Opens a file this backend opened or saved before, by its handle's path or else its name, without a dialog. Rejects with a DocumentError saying why when it cannot. A backend that never can leaves this out. */
  reopen?(id: string): Promise<OpenedFile<H>>
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

// without IndexedDB (a private window) the file still opens and saves, so this is reported rather than thrown
const rememberHandle = (handle: FileSystemFileHandle) => handleStore('readwrite', (store) => store.put(handle, handle.name))
  .catch((cause) => report(new DocumentError('handle-not-kept', `${handle.name} will not be offered under Open Recent: the browser could not keep it`, cause)))

/** Reads and writes real files on disk, with the OS's own open/save dialogs. */
export function createFileSystemAccessBackend(kind: FileKind = GRAPH_FILES): FileBackend<FsAccessHandle> {
  return {
    async reopen(name) {
      const handle = await handleStore<FileSystemFileHandle | undefined>('readonly', (store) => store.get(name)).catch((cause) => {
        throw new DocumentError('file-gone', 'the browser could not look it up', cause)
      })
      if (!handle) throw new DocumentError('file-gone', 'the browser no longer remembers it')
      // a handle from an earlier session has lost its permission; asking again needs the click that ran the command
      const permission = (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted'
      if (permission !== 'granted' && (await handle.requestPermission?.({ mode: 'read' })) !== 'granted') throw new DocumentError('permission-denied', 'reading it was not allowed')
      try {
        return { handle: { name: handle.name, handle }, text: await (await handle.getFile()).text() }
      } catch (cause) {
        throw new DocumentError('file-gone', 'it could not be read', cause)
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

/** No File System Access API: saving downloads a file and opening picks one through a plain file input. */
export function createDownloadBackend(kind: FileKind = GRAPH_FILES): FileBackend<DownloadHandle> {
  return {
    async open(extension, alsoAccept = []) {
      const file = await pickFile([extension, ...alsoAccept].join(','))
      if (!file) return null
      const text = await file.text()
      return { handle: { name: file.name, text }, text }
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
      } catch (cause) {
        throw new DocumentError('file-gone', 'it could not be read', cause)
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
