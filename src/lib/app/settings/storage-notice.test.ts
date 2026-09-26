import { afterEach, beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

it('reports each key that failed to load once, with what was reset and why, for failures before and after it is installed', async () => {
  vi.stubGlobal('localStorage', { getItem: (key: string) => (key === 'wledtoy:preferences' ? '[]' : '{broken') })
  const { loadStored } = await import('./storage')
  const { installStorageNotice } = await import('./storage-notice')
  const { logs } = await import('@/lib/app/logs')
  const sanitizeObject = (raw: unknown) => {
    if (Array.isArray(raw)) throw new Error('not an object')
    return raw
  }
  loadStored('wledtoy:graph:recent', 'your recent graph files', sanitizeObject, null)
  loadStored('wledtoy:graph:recent', 'your recent graph files', sanitizeObject, null)
  installStorageNotice()
  loadStored('wledtoy:graph:recent', 'your recent graph files', sanitizeObject, null)
  loadStored('wledtoy:preferences', 'your preferences', sanitizeObject, null)
  expect(logs.value.map((entry) => `${entry.level}: ${entry.message}`)).toEqual([
    expect.stringMatching(/^error: Your recent graph files could not be read and were reset to the defaults \[app storage-reset\] \(cause: /),
    'error: Your preferences could not be read and were reset to the defaults [app storage-reset] (cause: not an object)',
  ])
})
