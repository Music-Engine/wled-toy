import { nextTick, watch } from 'vue'
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
  vi.stubGlobal('window', { addEventListener: () => undefined })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function loadBoth(initial: Record<string, string> = {}) {
  vi.stubGlobal('localStorage', fakeLocalStorage(initial))
  const configModule = await import('./config')
  const devicesModule = await import('./devices')
  return { ...configModule, ...devicesModule }
}

describe('config mirrors the active device', () => {
  it('reads the migrated legacy fields at load, same as the pre-migration config did', async () => {
    const legacy = { host: 'wled.local', ledCount: 30, protocol: 'dnrgb', universe: 2 }
    const { config, activeDevice } = await loadBoth({ 'wledtoy:config': JSON.stringify(legacy) })
    expect(config.host).toBe('wled.local')
    expect(config.ledCount).toBe(30)
    expect(config.protocol).toBe('dnrgb')
    expect(config.universe).toBe(2)
    expect(activeDevice.value.host).toBe('wled.local')
  })

  it('switching devices updates config in one batch: a bridge re-send watcher fires exactly once', async () => {
    const { config, devices, addDevice, updateDevice, setActiveDevice } = await loadBoth()
    const first = devices.value[0].id
    const second = addDevice('Second')
    updateDevice(second.id, { host: 'second-host', protocol: 'artnet', universe: 5 })
    setActiveDevice(first)
    await nextTick()

    // mirrors engine.ts's own `watch(() => [config.host, config.protocol, config.universe], () => this.bridge.sendConfig())`
    const resend = vi.fn()
    watch(() => [config.host, config.protocol, config.universe], resend)

    setActiveDevice(second.id)
    await nextTick()

    expect(resend).toHaveBeenCalledTimes(1)
    expect(config.host).toBe('second-host')
    expect(config.protocol).toBe('artnet')
    expect(config.universe).toBe(5)
  })

  it('writes edits made directly to config (as importing a config without devices does) back into the active device', async () => {
    const { config, activeDevice } = await loadBoth()
    Object.assign(config, { host: 'edited-host', ledCount: 42, protocol: 'sacn', universe: 7, layout: null })
    await nextTick()
    expect(activeDevice.value.host).toBe('edited-host')
    expect(activeDevice.value.ledCount).toBe(42)
    expect(activeDevice.value.protocol).toBe('sacn')
    expect(activeDevice.value.universe).toBe(7)
  })

  it('mirrors a device edit into config exactly once, without looping back through the write-back watcher', async () => {
    const { config, updateDevice, activeDevice } = await loadBoth()
    const spy = vi.fn()
    watch(() => config.host, spy)
    updateDevice(activeDevice.value.id, { host: 'looped-host' })
    await nextTick()
    await nextTick()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(config.host).toBe('looped-host')
  })
})

describe('exported configs carry the saved devices', () => {
  it('exports every device and the active id next to the config fields', async () => {
    const { exportData, addDevice, updateDevice, devices, activeDeviceId } = await loadBoth()
    const second = addDevice('Stage')
    updateDevice(second.id, { host: 'stage.local', protocol: 'artnet', universe: 3 })
    await nextTick()
    const data = JSON.parse(JSON.stringify(exportData()))
    expect(data.devices).toHaveLength(2)
    expect(data.devices[1]).toMatchObject({ id: second.id, name: 'Stage', host: 'stage.local', protocol: 'artnet', universe: 3 })
    expect(data.devices).toEqual(JSON.parse(JSON.stringify(devices.value)))
    expect(data.activeDeviceId).toBe(activeDeviceId.value)
    expect(data.host).toBe('stage.local')
  })

  it('an import replaces the device list, sanitizes it, and config follows the imported active device', async () => {
    const { importData, config, devices, activeDevice, addDevice } = await loadBoth()
    addDevice('Gone after import')
    const picked = importData({
      fps: 50,
      host: 'stale-top-level-host',
      activeDeviceId: 'b',
      devices: [
        { id: 'a', name: 'Desk', host: ' desk.local ', ledCount: 30, protocol: 'ddp', universe: 0, layout: null },
        { id: 'b', name: 'Stage', host: 'stage.local', ledCount: 99999, protocol: 'sacn', universe: 4, layout: null },
        'not a device',
      ],
    })
    await nextTick()
    await nextTick()
    expect(devices.value.map((d) => d.name)).toEqual(['Desk', 'Stage'])
    expect(devices.value[0].host).toBe('desk.local')
    expect(devices.value[1].ledCount).toBe(4096)
    expect(activeDevice.value.id).toBe('b')
    expect(config).toMatchObject({ fps: 50, host: 'stage.local', protocol: 'sacn', universe: 4, ledCount: 4096 })
    expect(devices.value[1].host).toBe('stage.local')
    expect(Object.keys(picked)).toContain('devices')
  })

  it('a round trip through export and import restores the same devices in a fresh store', async () => {
    const first = await loadBoth()
    const added = first.addDevice('Porch')
    first.updateDevice(added.id, { host: 'porch.local', ledCount: 24 })
    first.duplicateDevice(added.id)
    await nextTick()
    const file = JSON.parse(JSON.stringify(first.exportData()))

    vi.resetModules()
    const second = await loadBoth()
    expect(second.devices.value).toHaveLength(1)
    second.importData(file)
    await nextTick()
    expect(JSON.parse(JSON.stringify(second.devices.value))).toEqual(file.devices)
    expect(second.activeDeviceId.value).toBe(file.activeDeviceId)
  })

  it('an older file without devices keeps the list and sets its device fields on the active device', async () => {
    const { importData, devices, activeDevice, addDevice } = await loadBoth()
    addDevice('Second')
    await nextTick()
    importData({ host: 'old-file.local', ledCount: 12, devices: [] })
    await nextTick()
    expect(devices.value).toHaveLength(2)
    expect(activeDevice.value).toMatchObject({ name: 'Second', host: 'old-file.local', ledCount: 12 })
  })
})
