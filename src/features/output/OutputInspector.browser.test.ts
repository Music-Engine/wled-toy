import { afterEach, expect, it } from 'vitest'
import { createApp, h, nextTick, type Component } from 'vue'
import OutputInspector from './OutputInspector.vue'
import { config } from '@/lib/app/settings/config'
import { activeDevice, addDevice, removeDevice, setActiveDevice } from '@/lib/app/settings/devices'
import { settingsView } from '@/lib/app/settings/preferences'

const initial = {
  brightness: config.brightness,
  scanY: config.scanY,
  fps: config.fps,
  protocol: config.protocol,
  universe: config.universe,
  layout: config.layout,
}

let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  Object.assign(config, initial)
})

function mount(component: Component) {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(component) })
  app.mount(root)
  unmount = () => {
    app.unmount()
    root.remove()
  }
  return root
}

function enter(root: HTMLElement, control: string, value: string, event: 'input' | 'change') {
  const el = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-control="${control}"]`)!
  el.value = value
  el.dispatchEvent(new Event(event, { bubbles: true }))
  return el
}

it('brightness and scan row write the config while the slider moves', async () => {
  const root = mount(OutputInspector)
  enter(root, 'brightness', '0.35', 'input')
  expect(config.brightness).toBe(0.35)
  enter(root, 'scanY', '0.8', 'input')
  expect(config.scanY).toBe(0.8)
  await nextTick()
  expect(root.textContent).toContain('35%')
  expect(root.textContent).toContain('0.80')
})

it('the scan row is not offered while a layout places the LEDs', async () => {
  const root = mount(OutputInspector)
  config.layout = { segments: [{ kind: 'matrix', width: 4, height: 4, origin: 'top-left', serpentine: false }] } as typeof config.layout
  await nextTick()
  expect(root.querySelector('[data-control="scanY"]')).toBeNull()
  expect(root.textContent).toContain('matrix 4x4')
})

it('the target rate and the protocol apply on change, and a rate out of range is clamped in the field too', async () => {
  const root = mount(OutputInspector)
  enter(root, 'fps', '45', 'change')
  expect(config.fps).toBe(45)
  const field = enter(root, 'fps', '500', 'change')
  expect(config.fps).toBe(120)
  expect(field.value).toBe('120')
  enter(root, 'fps', '', 'change')
  expect(config.fps).toBe(120)

  expect(root.querySelector('[data-control="universe"]')).toBeNull()
  enter(root, 'protocol', 'artnet', 'change')
  expect(config.protocol).toBe('artnet')
  await nextTick()
  enter(root, 'universe', '3', 'change')
  expect(config.universe).toBe(3)
})

it('switching the device in the inspector makes it the active device', async () => {
  const first = activeDevice.value.id
  const second = addDevice('Second strip')
  setActiveDevice(first)
  const root = mount(OutputInspector)
  await nextTick()
  try {
    expect(root.querySelector<HTMLSelectElement>('[data-control="device"]')!.value).toBe(first)
    enter(root, 'device', second.id, 'change')
    expect(activeDevice.value.id).toBe(second.id)
  } finally {
    setActiveDevice(first)
    removeDevice(second.id)
  }
})

it('Edit... next to the LED layout opens the preferences on Devices, where the layout is edited', () => {
  settingsView.open = false
  settingsView.section = 'general'
  const root = mount(OutputInspector)
  const edit = [...root.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Edit...')!
  edit.click()
  expect(settingsView.open).toBe(true)
  expect(settingsView.section).toBe('devices')
  settingsView.open = false
})
