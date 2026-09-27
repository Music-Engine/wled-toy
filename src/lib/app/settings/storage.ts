export interface StorageFailure {
  key: string
  /** What the user calls what was lost, for the notice: "your preferences". */
  name: string
  cause: unknown
}

// nothing here reports: logging from here would close a cycle (logs reads preferences, which load through here), so the
// failures before a listener exists wait in this list
export const storageFailures: StorageFailure[] = []
let listener: ((failure: StorageFailure) => void) | null = null

/** Hands `listen` every failure recorded so far, then each one as it is recorded. */
export function onStorageFailure(listen: (failure: StorageFailure) => void) {
  listener = listen
  storageFailures.forEach(listen)
}

// no storage at all (a test runner) or storage the browser forbids (blocked site data) leaves nothing to read, which is not corrupt data
function readStored(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'SecurityError') return null
    throw error
  }
}

/**
 * Reads a stored JSON value through the caller's sanitize. `defaults` may be a function when building them costs something;
 * it then runs only when they are needed. Missing or unavailable storage gives the defaults; a value
 * that does not parse or that sanitize rejects gives the defaults too, and is recorded in `storageFailures`.
 */
export function loadStored<T>(key: string, name: string, sanitize: (raw: unknown) => T, defaults: T | (() => T)): T {
  const fallback = () => (typeof defaults === 'function' ? (defaults as () => T)() : defaults)
  const raw = readStored(key)
  if (raw === null) return fallback()
  try {
    return sanitize(JSON.parse(raw))
  } catch (cause) {
    const failure = { key, name, cause }
    storageFailures.push(failure)
    listener?.(failure)
    return fallback()
  }
}
