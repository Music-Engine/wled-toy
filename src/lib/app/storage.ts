export interface StorageFailure {
  key: string
  cause: unknown
}

// nothing here reports: the next commit reads this list and reports each key once, and logging from here would close
// a cycle (logs reads preferences, which load through here)
export const storageFailures: StorageFailure[] = []

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
export function loadStored<T>(key: string, sanitize: (raw: unknown) => T, defaults: T | (() => T)): T {
  const fallback = () => (typeof defaults === 'function' ? (defaults as () => T)() : defaults)
  const raw = readStored(key)
  if (raw === null) return fallback()
  try {
    return sanitize(JSON.parse(raw))
  } catch (cause) {
    storageFailures.push({ key, cause })
    return fallback()
  }
}
