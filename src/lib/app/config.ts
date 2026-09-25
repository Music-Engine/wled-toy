import { reactive, watch } from 'vue'
import { activeDevice, activeDeviceId, devices, resetStoredDevices, restoreDevices, sanitizeDeviceStore, updateActiveDevice, type SavedDevice } from './devices'
import { EXAMPLE } from '@/lib/shader/glsl'
import { GRAPH_VERSION, type NodeGraph } from '@/lib/graph/model/doc'
import { layoutCount, parseLayout, type Layout } from '@/lib/engine/layout'
import { log } from './logs'
import { isTauri } from './platform'
import { resetStoredPreferences } from './preferences'
import type { WireProtocol } from '@/lib/engine/output'
import { loadTauriFiles } from '@/lib/documents/tauri-files'
import { resetLayout } from './workspace'
import { clamp } from '@/lib/util/math'
import { downloadText } from './download'
import { loadStored } from './storage'

export type Protocol = WireProtocol

export interface AppConfig {
  host: string
  ledCount: number
  fps: number
  protocol: Protocol
  /** First DMX universe, for Art-Net and sACN. */
  universe: number
  scanY: number
  brightness: number
  code: string
  graph: NodeGraph | null
  /** Where the LEDs physically are; null is a straight strip along the preview's scanline. Sets ledCount when present. */
  layout: Layout | null
}

export const DEFAULTS: AppConfig = {
  host: '',
  ledCount: 60,
  fps: 30,
  protocol: 'ddp',
  universe: 0,
  scanY: 0.5,
  brightness: 1,
  code: EXAMPLE,
  graph: null,
  layout: null,
}

const STORAGE_KEY = 'wledtoy:config'

export function sanitize(input: unknown): Partial<AppConfig> {
  if (!input || typeof input !== 'object') return {}
  const src = input as Record<string, unknown>
  const out: Partial<AppConfig> = {}
  if (typeof src.host === 'string') out.host = src.host.trim()
  if (typeof src.ledCount === 'number') out.ledCount = clamp(Math.round(src.ledCount), 1, 4096)
  if (typeof src.fps === 'number') out.fps = clamp(Math.round(src.fps), 1, 120)
  if (src.protocol === 'ddp' || src.protocol === 'dnrgb' || src.protocol === 'artnet' || src.protocol === 'sacn') out.protocol = src.protocol
  if (typeof src.universe === 'number') out.universe = clamp(Math.round(src.universe), 0, 32767)
  if (typeof src.scanY === 'number') out.scanY = clamp(src.scanY, 0, 1)
  if (typeof src.brightness === 'number') out.brightness = clamp(src.brightness, 0, 1)
  if (typeof src.code === 'string') out.code = src.code
  const graph = src.graph as Partial<NodeGraph> | null | undefined
  if (graph && Array.isArray(graph.nodes) && Array.isArray(graph.edges)) {
    // no migrations: a graph from an older version is dropped rather than half-understood
    out.graph = graph.version === GRAPH_VERSION ? (graph as NodeGraph) : null
    if (!out.graph) log(`A saved graph from an older version (${graph.version ?? 1}) was discarded; this version is ${GRAPH_VERSION}`, 'warn')
  }
  if ('layout' in src) {
    out.layout = parseLayout(src.layout)
    if (out.layout) out.ledCount = layoutCount(out.layout)
  }
  return out
}

export const config = reactive<AppConfig>(loadStored(STORAGE_KEY, 'your settings', (raw) => ({ ...DEFAULTS, ...sanitize(raw) }), { ...DEFAULTS }))

// host/ledCount/protocol/universe/layout live on the active saved device (src/lib/devices.ts); config mirrors it both ways
// so every existing read and write site keeps working against `config` directly.
const mirrorFromDevice = (device: { host: string; ledCount: number; protocol: Protocol; universe: number; layout: Layout | null }) =>
  Object.assign(config, { host: device.host, ledCount: device.ledCount, protocol: device.protocol, universe: device.universe, layout: device.layout })
mirrorFromDevice(activeDevice.value)
watch(activeDevice, mirrorFromDevice, { deep: true })
watch(() => [config.host, config.ledCount, config.protocol, config.universe, config.layout] as const, ([host, ledCount, protocol, universe, layout]) => {
  updateActiveDevice({ host, ledCount, protocol, universe, layout })
}, { deep: true })

let lastSerialized: string | null = localStorage.getItem(STORAGE_KEY)

watch(config, () => {
  const serialized = JSON.stringify(config)
  if (serialized === lastSerialized) return
  lastSerialized = serialized
  localStorage.setItem(STORAGE_KEY, serialized)
}, { deep: true })

// every open tab of the app shares this key; adopt other tabs' saves instead of overwriting them later
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY || event.newValue === null || event.newValue === lastSerialized) return
  try {
    const incoming = sanitize(JSON.parse(event.newValue))
    lastSerialized = event.newValue
    Object.assign(config, incoming)
  } catch {
    // a malformed value from elsewhere on this origin is ignored rather than breaking the app
  }
})

/** Forgets everything this app stored in the browser: settings, devices, preferences, layout, graph, song, images. The page reloads fresh. */
export async function resetStoredData() {
  localStorage.removeItem(STORAGE_KEY)
  resetStoredDevices()
  resetStoredPreferences()
  // workspace.ts has no way to drop its key; its own watcher stores the defaults before the reload below
  resetLayout()
  lastSerialized = null
  await Promise.all(['wledtoy-media', 'wledtoy-images'].map((name) => new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = request.onerror = request.onblocked = () => resolve()
  })))
  location.reload()
}

/** What an exported file holds: the config plus every saved device, which live under their own storage key. */
export function exportData() {
  return { app: 'wledtoy', version: 3, exportedAt: new Date().toISOString(), ...config, devices: devices.value, activeDeviceId: activeDeviceId.value }
}

/** False when the user cancels the native save dialog; a browser downloads the file and never says no. */
export async function exportConfig(): Promise<boolean> {
  const text = JSON.stringify(exportData(), null, 2)
  const name = `wledtoy-${Date.now()}.json`
  if (isTauri()) {
    const files = await loadTauriFiles()
    const path = await files.pickSave(name, { name: 'WLEDtoy config', extensions: ['json'] })
    if (path !== null) await files.writeTextFile(path, text)
    return path !== null
  }
  downloadText(name, text, 'application/json')
  return true
}

/** A file with saved devices replaces the device list, and its active device supplies the device fields; an older file only sets them on the active device. */
export function importData(raw: unknown): Partial<AppConfig> & { devices?: SavedDevice[] } {
  const picked: Partial<AppConfig> & { devices?: SavedDevice[] } = sanitize(raw)
  const list = (raw as { devices?: unknown } | null)?.devices
  if (Array.isArray(list) && list.length) {
    const store = sanitizeDeviceStore(raw)
    restoreDevices(store)
    const active = store.devices.find((device) => device.id === store.activeDeviceId)!
    Object.assign(picked, { host: active.host, ledCount: active.ledCount, protocol: active.protocol, universe: active.universe, layout: active.layout, devices: store.devices })
  }
  const { devices: _, ...fields } = picked
  Object.assign(config, fields)
  return picked
}

export async function importConfig(file: File) {
  return importData(JSON.parse(await file.text()))
}
