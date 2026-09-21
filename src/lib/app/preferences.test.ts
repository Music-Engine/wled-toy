import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function fakeLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  }
}

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

async function load(storage = fakeLocalStorage()) {
  vi.stubGlobal('localStorage', storage)
  return { storage, ...(await import('./preferences')) }
}

describe('sanitizePreferences', () => {
  it('gives the defaults for anything that is not an object', async () => {
    const { sanitizePreferences, PREFERENCE_DEFAULTS } = await load()
    for (const junk of [null, undefined, 'text', 4, []]) expect(sanitizePreferences(junk)).toEqual(PREFERENCE_DEFAULTS)
  })

  it('keeps each valid field and replaces each invalid one on its own', async () => {
    const { sanitizePreferences, PREFERENCE_DEFAULTS } = await load()
    const out = sanitizePreferences({
      launchMode: 'graph', lastMode: 'reference', autosave: 'yes', autosaveSeconds: 30, confirmClose: false,
      logLines: '500', previewFps: 30, previewHeight: 180, density: 'huge', editorFontSize: 16, reduceMotion: true, unknown: 1,
    })
    expect(out).toEqual({
      ...PREFERENCE_DEFAULTS,
      launchMode: 'graph', autosaveSeconds: 30, confirmClose: false, previewFps: 30, previewHeight: 180, editorFontSize: 16, reduceMotion: true,
    })
    expect(out).not.toHaveProperty('unknown')
  })

  it('the launch screen shows by default and the audio input starts on the built-in track; both keep a valid stored choice only', async () => {
    const { sanitizePreferences, PREFERENCE_DEFAULTS } = await load()
    expect([PREFERENCE_DEFAULTS.showLaunchScreen, PREFERENCE_DEFAULTS.audioSource]).toEqual([true, 'file'])
    expect(sanitizePreferences({ showLaunchScreen: false, audioSource: 'device' })).toMatchObject({ showLaunchScreen: false, audioSource: 'device' })
    expect(sanitizePreferences({ showLaunchScreen: 0, audioSource: 'radio' })).toMatchObject({ showLaunchScreen: true, audioSource: 'file' })
  })

  it('rounds and clamps numbers into their ranges and rejects non-finite ones', async () => {
    const { sanitizePreferences, PREFERENCE_DEFAULTS } = await load()
    expect(sanitizePreferences({ autosaveSeconds: 0, logLines: 1e9, previewFps: -5, editorFontSize: 13.6 })).toMatchObject({ autosaveSeconds: 1, logLines: 10000, previewFps: 0, editorFontSize: 14 })
    expect(sanitizePreferences({ editorFontSize: 99 }).editorFontSize).toBe(24)
    expect([-1, 1e6, NaN].map((previewHeight) => sanitizePreferences({ previewHeight }).previewHeight)).toEqual([0, 4320, PREFERENCE_DEFAULTS.previewHeight])
    expect(sanitizePreferences({ logLines: NaN, previewFps: Infinity })).toMatchObject({ logLines: PREFERENCE_DEFAULTS.logLines, previewFps: PREFERENCE_DEFAULTS.previewFps })
  })
})

describe('persistence', () => {
  it('stores a change under its own key and a fresh module reads it back', async () => {
    const first = await load()
    expect(first.storage.getItem('wledtoy:preferences')).toBeNull()
    first.preferences.density = 'compact'
    first.preferences.logLines = 1000
    await nextTick()
    expect(JSON.parse(first.storage.getItem('wledtoy:preferences')!)).toMatchObject({ density: 'compact', logLines: 1000 })
    expect(first.storage.getItem('wledtoy:config')).toBeNull()

    vi.resetModules()
    const second = await load(first.storage)
    expect(second.preferences).not.toBe(first.preferences)
    expect(second.preferences.density).toBe('compact')
    expect(second.preferences.logLines).toBe(1000)
  })

  it('survives a corrupt or hostile stored value', async () => {
    const corrupt = await load(fakeLocalStorage({ 'wledtoy:preferences': '{not json' }))
    expect(corrupt.preferences).toEqual(corrupt.PREFERENCE_DEFAULTS)
    vi.resetModules()
    const hostile = await load(fakeLocalStorage({ 'wledtoy:preferences': JSON.stringify({ density: 7, editorFontSize: 500 }) }))
    expect(hostile.preferences.density).toBe('default')
    expect(hostile.preferences.editorFontSize).toBe(24)
  })

  it('resetPreferences restores the defaults but keeps the last used mode, and resetStoredPreferences drops the key', async () => {
    const { preferences, resetPreferences, resetStoredPreferences, storage, PREFERENCE_DEFAULTS } = await load()
    Object.assign(preferences, { lastMode: 'graph', reduceMotion: true, previewFps: 24 })
    await nextTick()
    resetPreferences()
    expect(preferences).toEqual({ ...PREFERENCE_DEFAULTS, lastMode: 'graph' })
    await nextTick()
    expect(storage.getItem('wledtoy:preferences')).not.toBeNull()
    resetStoredPreferences()
    expect(storage.getItem('wledtoy:preferences')).toBeNull()
  })
})

describe('launch mode', () => {
  it('redirects only a launch at the root path, to the chosen or the last used editor', async () => {
    const { preferences, launchPath, rememberMode } = await load()
    expect(launchPath('/')).toBeNull()
    preferences.launchMode = 'graph'
    expect(launchPath('/')).toBe('/graph')
    expect(launchPath('/reference')).toBeNull()
    preferences.launchMode = 'last'
    rememberMode('reference')
    expect(launchPath('/')).toBeNull()
    rememberMode('graph')
    expect(launchPath('/')).toBe('/graph')
    preferences.launchMode = 'shader'
    expect(launchPath('/')).toBeNull()
  })
})

describe('log retention', () => {
  it('the log keeps as many lines as the preference says', async () => {
    const { preferences } = await load()
    const { log, logs } = await import('./logs')
    preferences.logLines = 50
    for (let i = 0; i < 60; i++) log(`line ${i}`)
    expect(logs.value).toHaveLength(50)
    expect(logs.value[0].message).toBe('line 10')
  })
})
