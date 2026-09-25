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

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function loadDevices(initial: Record<string, string> = {}) {
  vi.stubGlobal('localStorage', fakeLocalStorage(initial))
  return import('./devices')
}

describe('devices store', () => {
  it('seeds one default device when nothing is stored', async () => {
    const { devices, activeDevice, activeDeviceId } = await loadDevices()
    expect(devices.value).toHaveLength(1)
    expect(activeDevice.value.name).toBe('Default')
    expect(activeDevice.value.host).toBe('')
    expect(activeDeviceId.value).toBe(devices.value[0].id)
  })

  it('migrates the legacy config fields into the first device with nothing lost', async () => {
    const legacyLayout = { segments: [{ kind: 'strip', count: 120, from: [0, 0], to: [1, 0] }] }
    const legacy = { host: '192.168.1.5', ledCount: 999, protocol: 'artnet', universe: 3, layout: legacyLayout }
    const { devices, activeDevice } = await loadDevices({ 'wledtoy:config': JSON.stringify(legacy) })
    expect(devices.value).toHaveLength(1)
    expect(activeDevice.value.host).toBe('192.168.1.5')
    // the layout's own count overrides the raw ledCount, same as config.ts's sanitize()
    expect(activeDevice.value.ledCount).toBe(120)
    expect(activeDevice.value.protocol).toBe('artnet')
    expect(activeDevice.value.universe).toBe(3)
    expect(activeDevice.value.layout).toEqual(legacyLayout)
  })

  it('falls back to one device when the stored device list is empty or invalid', async () => {
    const { devices, activeDeviceId } = await loadDevices({ 'wledtoy:devices': JSON.stringify({ devices: ['garbage', 42, null], activeDeviceId: 'nope' }) })
    expect(devices.value).toHaveLength(1)
    expect(activeDeviceId.value).toBe(devices.value[0].id)
  })

  it('falls back to the first device when activeDeviceId points nowhere', async () => {
    const stored = { devices: [{ id: 'a', name: 'A', host: 'a-host', ledCount: 60, protocol: 'ddp', universe: 0, layout: null }], activeDeviceId: 'missing' }
    const { activeDeviceId, activeDevice } = await loadDevices({ 'wledtoy:devices': JSON.stringify(stored) })
    expect(activeDeviceId.value).toBe('a')
    expect(activeDevice.value.host).toBe('a-host')
  })

  it('validates and clamps each device field like config sanitize', async () => {
    const stored = { devices: [{ id: 'a', name: 'A', host: '  h  ', ledCount: 999999, protocol: 'nope', universe: -5 }], activeDeviceId: 'a' }
    const { activeDevice } = await loadDevices({ 'wledtoy:devices': JSON.stringify(stored) })
    expect(activeDevice.value.host).toBe('h')
    expect(activeDevice.value.ledCount).toBe(4096)
    expect(activeDevice.value.protocol).toBe('ddp')
    expect(activeDevice.value.universe).toBe(0)
  })

  it('keeps ids as stable strings across a reload', async () => {
    const stored = { devices: [{ id: 'stable-id', name: 'A', host: '', ledCount: 60, protocol: 'ddp', universe: 0, layout: null }], activeDeviceId: 'stable-id' }
    const { activeDevice } = await loadDevices({ 'wledtoy:devices': JSON.stringify(stored) })
    expect(activeDevice.value.id).toBe('stable-id')
  })

  it('adds, duplicates, edits and removes devices, persisting to localStorage', async () => {
    const { addDevice, duplicateDevice, updateDevice, removeDevice, setActiveDevice, devices, activeDeviceId } = await loadDevices()
    const first = devices.value[0].id

    const second = addDevice('Second')
    expect(devices.value).toHaveLength(2)
    expect(activeDeviceId.value).toBe(second.id)

    const dup = duplicateDevice(second.id)!
    expect(devices.value).toHaveLength(3)
    expect(dup.name).toBe('Second copy')
    expect(dup.id).not.toBe(second.id)

    updateDevice(dup.id, { host: 'dup-host' })
    expect(devices.value.find((d) => d.id === dup.id)!.host).toBe('dup-host')

    setActiveDevice(first)
    removeDevice(second.id)
    expect(devices.value).toHaveLength(2)
    expect(activeDeviceId.value).toBe(first) // removing a non-active device leaves the active one alone

    setActiveDevice(dup.id)
    removeDevice(dup.id)
    expect(devices.value).toHaveLength(1)
    expect(activeDeviceId.value).toBe(first) // removing the active device activates its neighbor

    removeDevice(first)
    expect(devices.value).toHaveLength(1) // the last device cannot be removed

    await nextTick()
    const raw = JSON.parse(localStorage.getItem('wledtoy:devices')!)
    expect(raw.devices).toHaveLength(1)
    expect(raw.activeDeviceId).toBe(first)
  })

  it('ignores a device id that does not exist when switching', async () => {
    const { setActiveDevice, activeDeviceId } = await loadDevices()
    const before = activeDeviceId.value
    setActiveDevice('does-not-exist')
    expect(activeDeviceId.value).toBe(before)
  })
})

describe('validateHost', () => {
  it('accepts no host, host names and IP addresses', async () => {
    const { validateHost } = await loadDevices()
    for (const host of ['', 'wled.local', 'WLED-Kitchen', '192.168.1.50', 'a']) expect(validateHost(host)).toBeNull()
  })

  it('asks to leave out the scheme', async () => {
    const { validateHost } = await loadDevices()
    expect(validateHost('http://wled.local')).toBe('Leave out http:// and anything after the host name.')
  })

  it('rejects a port, a path or stray characters', async () => {
    const { validateHost } = await loadDevices()
    for (const host of ['wled.local:80', 'wled.local/json', '-wled', 'wled.', 'my wled']) expect(validateHost(host)).toMatch(/^Enter a host name/)
  })
})
