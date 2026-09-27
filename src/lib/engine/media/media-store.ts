/**
 * The user's own song and image, kept across reloads. They are files of several megabytes, so they live in
 * IndexedDB as blobs: localStorage holds strings only and a few megabytes in total.
 */
export type MediaKey = 'song' | 'image'

export interface StoredMedia {
  blob: Blob
  name: string
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('wledtoy-media', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('media')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const request = run(db.transaction('media', mode).objectStore('media'))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).finally(() => db.close()))
}

export const saveMedia = (key: MediaKey, media: StoredMedia) => transact('readwrite', (store) => store.put(media, key))
export const loadMedia = (key: MediaKey) => transact<StoredMedia | undefined>('readonly', (store) => store.get(key))
export const clearMedia = (key: MediaKey) => transact('readwrite', (store) => store.delete(key))
