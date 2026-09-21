import { reactive, watch } from 'vue'

export type LaunchMode = 'shader' | 'graph' | 'last'
export type Density = 'compact' | 'default' | 'comfortable'
export type SettingsSection = 'general' | 'appearance' | 'devices' | 'output' | 'shortcuts' | 'data'

export interface Preferences {
  showLaunchScreen: boolean
  launchMode: LaunchMode
  /** The editor mode the app was last in; what `launchMode: 'last'` opens. */
  lastMode: 'shader' | 'graph'
  /** What the audio input listens to when the app starts; a graph's Audio Source node still has the last word. */
  audioSource: 'file' | 'device' | 'loopback'
  autosave: boolean
  autosaveSeconds: number
  confirmClose: boolean
  logLines: number
  /** Frames per second of the preview; 0 follows the display. */
  previewFps: number
  /** Rows the preview shades; 0 follows the display. */
  previewHeight: number
  density: Density
  editorFontSize: number
  reduceMotion: boolean
}

export const PREFERENCE_DEFAULTS: Preferences = {
  showLaunchScreen: true,
  launchMode: 'last',
  lastMode: 'shader',
  audioSource: 'file',
  autosave: true,
  autosaveSeconds: 5,
  confirmClose: true,
  logLines: 300,
  previewFps: 0,
  previewHeight: 0,
  density: 'default',
  editorFontSize: 14,
  reduceMotion: false,
}

// its own key, like the workspace layout: preferences belong to this install, not to a show file that exportConfig hands to somebody else
const STORAGE_KEY = 'wledtoy:preferences'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Keeps every valid field of a stored value and takes the default for the rest. */
export function sanitizePreferences(input: unknown): Preferences {
  const out = { ...PREFERENCE_DEFAULTS }
  if (!input || typeof input !== 'object') return out
  const src = input as Record<string, unknown>
  const int = (value: unknown, lo: number, hi: number, fallback: number) =>
    (typeof value === 'number' && Number.isFinite(value) ? clamp(Math.round(value), lo, hi) : fallback)
  if (typeof src.showLaunchScreen === 'boolean') out.showLaunchScreen = src.showLaunchScreen
  if (src.audioSource === 'file' || src.audioSource === 'device' || src.audioSource === 'loopback') out.audioSource = src.audioSource
  if (src.launchMode === 'shader' || src.launchMode === 'graph' || src.launchMode === 'last') out.launchMode = src.launchMode
  if (src.lastMode === 'shader' || src.lastMode === 'graph') out.lastMode = src.lastMode
  if (typeof src.autosave === 'boolean') out.autosave = src.autosave
  out.autosaveSeconds = int(src.autosaveSeconds, 1, 600, out.autosaveSeconds)
  if (typeof src.confirmClose === 'boolean') out.confirmClose = src.confirmClose
  out.logLines = int(src.logLines, 50, 10000, out.logLines)
  out.previewFps = int(src.previewFps, 0, 240, out.previewFps)
  out.previewHeight = int(src.previewHeight, 0, 4320, out.previewHeight)
  if (src.density === 'compact' || src.density === 'default' || src.density === 'comfortable') out.density = src.density
  out.editorFontSize = int(src.editorFontSize, 10, 24, out.editorFontSize)
  if (typeof src.reduceMotion === 'boolean') out.reduceMotion = src.reduceMotion
  return out
}

function load(): Preferences {
  try {
    return sanitizePreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'))
  } catch {
    return { ...PREFERENCE_DEFAULTS }
  }
}

export const preferences = reactive<Preferences>(load())

watch(() => JSON.stringify(preferences), (serialized) => localStorage.setItem(STORAGE_KEY, serialized))

export function resetPreferences() {
  Object.assign(preferences, PREFERENCE_DEFAULTS, { lastMode: preferences.lastMode })
}

/** Used by config.ts's resetStoredData(), which reloads the page right after. */
export function resetStoredPreferences() {
  localStorage.removeItem(STORAGE_KEY)
}

export function rememberMode(mode: unknown) {
  if (mode === 'shader' || mode === 'graph') preferences.lastMode = mode
}

/** Where a launch at the root path goes instead, or null to stay. A deep link to any other path wins over the preference. */
export function launchPath(path: string): string | null {
  if (path !== '/') return null
  const mode = preferences.launchMode === 'last' ? preferences.lastMode : preferences.launchMode
  return mode === 'graph' ? '/graph' : null
}

/** Keeps the document in step with the appearance preferences; main.css reads the attributes and the variable. */
export function applyPreferences(root: HTMLElement = document.documentElement): () => void {
  return watch(() => [preferences.density, preferences.editorFontSize, preferences.reduceMotion] as const, ([density, editorFontSize, reduceMotion]) => {
    root.dataset.density = density
    root.style.setProperty('--app-editor-font-size', `${editorFontSize}px`)
    root.toggleAttribute('data-reduce-motion', reduceMotion)
  }, { immediate: true })
}

export const launchScreen = reactive({ open: false })

export const settingsView = reactive({ open: false, section: 'general' as SettingsSection })

let opener: Element | null = null

/** Opens the preferences view, on a given section when the caller links to one. Focus goes back to `returnFocusTo`, or to what had it. */
export function openSettings(section?: SettingsSection, returnFocusTo?: HTMLElement) {
  if (section) settingsView.section = section
  if (!settingsView.open) opener = returnFocusTo ?? document.activeElement
  settingsView.open = true
}

/** The element that had focus when the view opened, if it is still on screen to take focus back. */
export const settingsOpener = () => (opener instanceof HTMLElement && opener.isConnected ? opener : null)
