import { reactive } from 'vue'
import { log, report } from '@/lib/app/logs'
import { EngineError } from './engine-error'

export interface LibraryImage {
  /** What nodes store. The file name it was added under; stays the same when the image is renamed. */
  id: string
  name: string
  /** For thumbnails and for decoding; an object URL, or the asset path of the built-in image. */
  url: string
  blob: Blob | null
}

export const BUILT_IN_IMAGE = 'builtin'

const DATABASE = 'wledtoy-images'

function store<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('images', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).then((db) => new Promise<T>((resolve, reject) => {
    const request = run(db.transaction('images', mode).objectStore('images'))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).finally(() => db.close()))
}

/**
 * The images Image Texture nodes can pick from: the built-in one plus whatever the user opened or linked. They are
 * shared by every node and graph, and kept in IndexedDB (they are far too large for localStorage).
 */
export class ImageLibrary {
  readonly images = reactive<LibraryImage[]>([{ id: BUILT_IN_IMAGE, name: 'Built-in image', url: '/assets/image.jpg', blob: null }])
  /** Settles once the images of earlier visits are back. */
  readonly ready: Promise<void>

  constructor() {
    this.ready = store<{ id: string; name: string; blob: Blob }[]>('readonly', (s) => s.getAll())
      .then((saved) => saved.forEach((image) => this.images.push({ ...image, url: URL.createObjectURL(image.blob) })))
      .catch((cause) => report(new EngineError('media-store', 'The images of earlier visits could not be loaded', cause)))
  }

  get(id: string): LibraryImage | undefined {
    return this.images.find((image) => image.id === (id || BUILT_IN_IMAGE))
  }

  /** Adds a file under its name; a second file of the same name gets a numbered id so neither replaces the other. */
  async add(blob: Blob, name: string): Promise<LibraryImage> {
    let id = name
    for (let n = 2; this.get(id); n++) id = `${name} (${n})`
    const image: LibraryImage = { id, name, blob, url: URL.createObjectURL(blob) }
    this.images.push(image)
    await store('readwrite', (s) => s.put({ id, name, blob })).catch((e) => log(`Could not keep ${name} for next time: ${(e as Error).message}`, 'warn'))
    return image
  }

  /** Downloads an image into the library. The server has to allow cross-origin reads, or the browser refuses. */
  async addFromUrl(url: string): Promise<LibraryImage> {
    const response = await fetch(url)
    if (!response.ok) throw new EngineError('image-fetch', `${response.status} ${response.statusText}`)
    const blob = await response.blob()
    if (!blob.type.startsWith('image/')) throw new EngineError('not-an-image', `that is ${blob.type || 'not an image'}`)
    return this.add(blob, decodeURIComponent(new URL(url).pathname.split('/').pop() || 'linked image'))
  }

  async rename(id: string, name: string) {
    const image = this.get(id)
    if (!image?.blob || !name.trim()) return
    image.name = name.trim()
    await store('readwrite', (s) => s.put({ id, name: image.name, blob: image.blob })).catch((cause) => report(new EngineError('media-store', `The new name of ${image.name} could not be kept`, cause)))
  }

  async remove(id: string) {
    const index = this.images.findIndex((image) => image.id === id && image.blob)
    if (index < 0) return
    URL.revokeObjectURL(this.images[index].url)
    this.images.splice(index, 1)
    await store('readwrite', (s) => s.delete(id)).catch((cause) => report(new EngineError('media-store', `${id} could not be removed for good and may come back`, cause)))
  }
}
