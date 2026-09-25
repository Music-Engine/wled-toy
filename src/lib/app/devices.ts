import { computed, reactive, watch } from 'vue'
import { layoutCount, parseLayout, type Layout } from '@/lib/engine/layout'
import type { WireProtocol } from '@/lib/engine/output'
import { clamp } from '@/lib/util/math'
import { newId } from '@/lib/util/ids'

export interface SavedDevice {
  id: string
  name: string
  host: string
  ledCount: number
  protocol: WireProtocol
  universe: number
  layout: Layout | null
}

interface DeviceStore {
  devices: SavedDevice[]
  activeDeviceId: string
}

const STORAGE_KEY = 'wledtoy:devices'
// migration only: the config storage key from src/lib/config.ts, read directly to avoid a circular import
const LEGACY_CONFIG_KEY = 'wledtoy:config'

const defaultDevice = (): SavedDevice => ({
  id: newId(),
  name: 'Default',
  host: '',
  ledCount: 60,
  protocol: 'ddp',
  universe: 0,
  layout: null,
})

/** Builds the first device from whatever the pre-migration config storage held, defaults for anything missing or invalid. */
function legacyDevice(): SavedDevice {
  const fallback = defaultDevice()
  try {
    const raw = localStorage.getItem(LEGACY_CONFIG_KEY)
    if (!raw) return fallback
    const src = JSON.parse(raw) as Record<string, unknown>
    if (typeof src.host === 'string') fallback.host = src.host.trim()
    if (typeof src.ledCount === 'number') fallback.ledCount = clamp(Math.round(src.ledCount), 1, 4096)
    if (src.protocol === 'ddp' || src.protocol === 'dnrgb' || src.protocol === 'artnet' || src.protocol === 'sacn') fallback.protocol = src.protocol
    if (typeof src.universe === 'number') fallback.universe = clamp(Math.round(src.universe), 0, 32767)
    if ('layout' in src) {
      fallback.layout = parseLayout(src.layout)
      if (fallback.layout) fallback.ledCount = layoutCount(fallback.layout)
    }
    return fallback
  } catch {
    return fallback
  }
}

function sanitizeDevice(input: unknown, fallback: SavedDevice): SavedDevice | null {
  if (!input || typeof input !== 'object') return null
  const src = input as Record<string, unknown>
  const out: SavedDevice = { ...fallback }
  out.id = typeof src.id === 'string' && src.id ? src.id : newId()
  out.name = typeof src.name === 'string' && src.name.trim() ? src.name.trim() : fallback.name
  if (typeof src.host === 'string') out.host = src.host.trim()
  if (typeof src.ledCount === 'number') out.ledCount = clamp(Math.round(src.ledCount), 1, 4096)
  if (src.protocol === 'ddp' || src.protocol === 'dnrgb' || src.protocol === 'artnet' || src.protocol === 'sacn') out.protocol = src.protocol
  if (typeof src.universe === 'number') out.universe = clamp(Math.round(src.universe), 0, 32767)
  if ('layout' in src) {
    out.layout = parseLayout(src.layout)
    if (out.layout) out.ledCount = layoutCount(out.layout)
  }
  return out
}

/** Field-by-field validation like config's own sanitize(); an empty or invalid list falls back to one device built from the legacy fields. */
export function sanitizeDeviceStore(input: unknown): DeviceStore {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const rawList = Array.isArray(src.devices) ? src.devices : []
  const devices = rawList
    .map((raw) => sanitizeDevice(raw, defaultDevice()))
    .filter((d): d is SavedDevice => d !== null)
  if (devices.length === 0) devices.push(legacyDevice())
  const activeDeviceId = typeof src.activeDeviceId === 'string' && devices.some((d) => d.id === src.activeDeviceId)
    ? src.activeDeviceId
    : devices[0].id
  return { devices, activeDeviceId }
}

function load(): DeviceStore {
  try {
    return sanitizeDeviceStore(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'))
  } catch {
    return { devices: [legacyDevice()], activeDeviceId: '' } // activeDeviceId fixed up below once the device's real id is known
  }
}

const store = reactive<DeviceStore>(load())
if (!store.devices.some((d) => d.id === store.activeDeviceId)) store.activeDeviceId = store.devices[0].id

let lastSerialized: string | null = localStorage.getItem(STORAGE_KEY)

watch(store, () => {
  const serialized = JSON.stringify(store)
  if (serialized === lastSerialized) return
  lastSerialized = serialized
  localStorage.setItem(STORAGE_KEY, serialized)
}, { deep: true })

export const devices = computed(() => store.devices)
export const activeDeviceId = computed(() => store.activeDeviceId)
export const activeDevice = computed(() => store.devices.find((d) => d.id === store.activeDeviceId) ?? store.devices[0])

export function setActiveDevice(id: string) {
  if (store.devices.some((d) => d.id === id)) store.activeDeviceId = id
}

export function updateDevice(id: string, patch: Partial<Omit<SavedDevice, 'id'>>) {
  const device = store.devices.find((d) => d.id === id)
  if (device) Object.assign(device, patch)
}

/** Merges into the currently active device; used to keep it in sync with the legacy config fields it mirrors. */
export function updateActiveDevice(patch: Partial<Omit<SavedDevice, 'id'>>) {
  updateDevice(activeDevice.value.id, patch)
}

export function addDevice(name = `Device ${store.devices.length + 1}`): SavedDevice {
  const created = { ...defaultDevice(), name }
  store.devices.push(created)
  store.activeDeviceId = created.id
  return created
}

export function duplicateDevice(id: string): SavedDevice | null {
  const source = store.devices.find((d) => d.id === id)
  if (!source) return null
  const copy = { ...source, id: newId(), name: `${source.name} copy` }
  store.devices.push(copy)
  return copy
}

/** The last device cannot be removed. Removing the active device activates the neighbor before it, or the new first device. */
export function removeDevice(id: string) {
  if (store.devices.length <= 1) return
  const index = store.devices.findIndex((d) => d.id === id)
  if (index === -1) return
  store.devices.splice(index, 1)
  if (store.activeDeviceId === id) store.activeDeviceId = store.devices[Math.max(0, index - 1)].id
}

/** Replaces every saved device with a sanitized store, as importing a config does. */
export function restoreDevices(next: DeviceStore) {
  store.devices = next.devices
  store.activeDeviceId = next.activeDeviceId
}

/** Used by config.ts's resetStoredData(), which reloads the page right after: the in-memory store does not need resetting too. */
export function resetStoredDevices() {
  localStorage.removeItem(STORAGE_KEY)
}
