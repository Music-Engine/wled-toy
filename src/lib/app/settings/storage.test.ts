import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function fakeLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return { getItem: (key: string) => (store.has(key) ? store.get(key)! : null) }
}

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

async function load(initial: Record<string, string> = {}) {
  vi.stubGlobal('localStorage', fakeLocalStorage(initial))
  return import('./storage')
}

const sanitizeCount = (raw: unknown) => {
  if (typeof raw !== 'object' || raw === null || typeof (raw as { count?: unknown }).count !== 'number') throw new Error('no count')
  return { count: (raw as { count: number }).count }
}

describe('loadStored', () => {
  it('returns what sanitize makes of a valid value and records nothing', async () => {
    const { loadStored, storageFailures } = await load({ k: '{"count":3}' })
    expect(loadStored('k', 'the count', sanitizeCount, { count: 0 })).toEqual({ count: 3 })
    expect(storageFailures).toEqual([])
  })

  it('builds defaults given as a function only when they are needed', async () => {
    const { loadStored } = await load({ k: '{"count":3}' })
    const defaults = vi.fn(() => ({ count: 0 }))
    expect(loadStored('k', 'the count', sanitizeCount, defaults)).toEqual({ count: 3 })
    expect(defaults).not.toHaveBeenCalled()
    expect(loadStored('missing', 'the count', sanitizeCount, defaults)).toEqual({ count: 0 })
    expect(defaults).toHaveBeenCalledOnce()
  })

  it('returns the defaults for a missing key without recording a failure', async () => {
    const { loadStored, storageFailures } = await load()
    const defaults = { count: 0 }
    expect(loadStored('k', 'the count', sanitizeCount, defaults)).toBe(defaults)
    expect(storageFailures).toEqual([])
  })

  it('returns the defaults without recording a failure when there is no storage', async () => {
    const { loadStored, storageFailures } = await import('./storage')
    expect(typeof localStorage).toBe('undefined')
    const defaults = { count: 0 }
    expect(loadStored('k', 'the count', sanitizeCount, defaults)).toBe(defaults)
    expect(storageFailures).toEqual([])
  })

  it('returns the defaults without recording a failure when the browser forbids storage', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new DOMException('blocked', 'SecurityError') } })
    const { loadStored, storageFailures } = await import('./storage')
    const defaults = { count: 0 }
    expect(loadStored('k', 'the count', sanitizeCount, defaults)).toBe(defaults)
    expect(storageFailures).toEqual([])
  })

  it('returns the defaults for corrupt JSON and records the key and cause', async () => {
    const { loadStored, storageFailures } = await load({ k: '{not json' })
    const defaults = { count: 0 }
    expect(loadStored('k', 'the count', sanitizeCount, defaults)).toBe(defaults)
    expect(storageFailures).toHaveLength(1)
    expect(storageFailures[0].key).toBe('k')
    expect(storageFailures[0].cause).toBeInstanceOf(SyntaxError)
  })

  it('returns the defaults when sanitize throws on a value of the wrong shape, and records the cause', async () => {
    const { loadStored, storageFailures } = await load({ k: '[1, 2]' })
    const defaults = { count: 0 }
    expect(loadStored('k', 'the count', sanitizeCount, defaults)).toBe(defaults)
    expect(storageFailures).toEqual([{ key: 'k', name: 'the count', cause: new Error('no count') }])
  })
})
