import { afterEach, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createApp, h, nextTick } from 'vue'
import SettingsView from './SettingsView.vue'
import { formatAccelerator } from '@/lib/app/commands'
import { activeDevice, devices, removeDevice, setActiveDevice, updateDevice } from '@/lib/app/devices'
import { applyPreferences, openSettings, preferences, resetPreferences, settingsView } from '@/lib/app/preferences'

let unmount: (() => void) | undefined
afterEach(async () => {
  settingsView.open = false
  settingsView.section = 'general'
  await nextTick()
  unmount?.()
  const [first, ...rest] = devices.value.map((device) => device.id)
  setActiveDevice(first)
  rest.forEach(removeDevice)
  updateDevice(first, { name: 'Default', host: '', ledCount: 60, protocol: 'ddp', universe: 0, layout: null })
  resetPreferences()
})

function mount() {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => [h('button', { id: 'opener', onClick: () => openSettings() }, 'Open preferences'), h(SettingsView)] })
  app.mount(root)
  unmount = () => { app.unmount(); root.remove() }
  return root.querySelector<HTMLButtonElement>('#opener')!
}

const view = () => document.querySelector<HTMLElement>('.settings-view')
const tab = (label: string) => [...view()!.querySelectorAll<HTMLElement>('[role="tab"]')].find((el) => el.textContent!.trim() === label)!
const selectedTab = () => view()!.querySelector('[role="tab"][aria-selected="true"]')!.textContent!.trim()
const heading = () => view()!.querySelector('header h2')!.textContent!.trim()
const action = (name: string) => view()!.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!
const field = (name: string) => view()!.querySelector<HTMLInputElement>(`input[data-field="${name}"]`)!
const deviceRows = () => [...view()!.querySelectorAll<HTMLElement>('[data-device]')]
const selectedDevice = () => view()!.querySelector('.device-detail h3')!.textContent!.trim()

it('stays closed until asked, then moves between sections by click and by arrow key', async () => {
  const opener = mount()
  expect(view()).toBeNull()
  await userEvent.click(opener)
  await expect.poll(() => view()).not.toBeNull()
  expect(view()!.getAttribute('role')).toBe('dialog')
  expect([...view()!.querySelectorAll('[role="tab"]')].map((el) => el.textContent!.trim())).toEqual(['General', 'Appearance', 'Devices', 'Output', 'Shortcuts', 'Data'])
  expect([selectedTab(), heading()]).toEqual(['General', 'General'])

  await userEvent.click(tab('Output'))
  expect([selectedTab(), heading(), settingsView.section]).toEqual(['Output', 'Output', 'output'])
  expect(field('fps')).not.toBeNull()

  await userEvent.keyboard('{ArrowDown}')
  expect([selectedTab(), heading()]).toEqual(['Shortcuts', 'Shortcuts'])
  expect(document.activeElement).toBe(tab('Shortcuts'))
  await userEvent.keyboard('{ArrowUp}{ArrowUp}')
  expect(selectedTab()).toBe('Devices')
  await userEvent.keyboard('{Home}')
  expect(selectedTab()).toBe('General')
})

it('opens directly on a linked section', async () => {
  mount()
  openSettings('devices')
  await expect.poll(() => view()).not.toBeNull()
  expect([selectedTab(), heading()]).toEqual(['Devices', 'Devices'])
  expect(deviceRows()).toHaveLength(1)
})

it('adds, duplicates, activates and removes devices through the store', async () => {
  mount()
  openSettings('devices')
  await expect.poll(() => view()).not.toBeNull()
  const original = activeDevice.value.id
  expect(action('remove').disabled).toBe(true)

  await userEvent.click(action('add'))
  expect(devices.value.map((d) => d.name)).toEqual(['Default', 'Device 2'])
  expect(selectedDevice()).toBe('Device 2')
  expect(activeDevice.value.name).toBe('Device 2')
  expect(action('remove').disabled).toBe(false)

  await userEvent.click(action('duplicate'))
  expect(devices.value.map((d) => d.name)).toEqual(['Default', 'Device 2', 'Device 2 copy'])
  expect(selectedDevice()).toBe('Device 2 copy')
  // a copy is a profile to edit, not the target of the stream
  expect(activeDevice.value.name).toBe('Device 2')
  expect(view()!.querySelector('.device-detail [data-state="active"]')).toBeNull()

  await userEvent.click(action('activate'))
  expect(activeDevice.value.name).toBe('Device 2 copy')
  expect(view()!.querySelector('.device-detail [data-state="active"]')).not.toBeNull()

  await userEvent.click(deviceRows()[0])
  expect(selectedDevice()).toBe('Default')
  await userEvent.click(action('activate'))
  expect(activeDevice.value.id).toBe(original)

  await userEvent.click(deviceRows()[2])
  await userEvent.click(action('remove'))
  expect(devices.value.map((d) => d.name)).toEqual(['Default', 'Device 2'])
  expect(selectedDevice()).toBe('Device 2')
  await userEvent.click(action('remove'))
  expect(devices.value.map((d) => d.name)).toEqual(['Default'])
  expect(action('remove').disabled).toBe(true)
})

it('commits the host on blur or Enter, never per keystroke, and refuses what is not a host', async () => {
  mount()
  openSettings('devices')
  await expect.poll(() => view()).not.toBeNull()

  await userEvent.click(field('host'))
  await userEvent.keyboard('wled.local')
  expect(field('host').value).toBe('wled.local')
  expect(activeDevice.value.host).toBe('')
  await userEvent.tab()
  expect(activeDevice.value.host).toBe('wled.local')

  await userEvent.fill(field('host'), '192.168.1.50')
  expect(activeDevice.value.host).toBe('wled.local')
  await userEvent.keyboard('{Enter}')
  expect(activeDevice.value.host).toBe('192.168.1.50')

  await userEvent.fill(field('host'), 'http://192.168.1.50/')
  await userEvent.tab()
  expect(activeDevice.value.host).toBe('192.168.1.50')
  expect(view()!.querySelector('[role="alert"]')!.textContent).toContain('http://')

  await userEvent.fill(field('ledCount'), '5000')
  await userEvent.tab()
  expect(activeDevice.value.ledCount).toBe(60)
  expect([...view()!.querySelectorAll('[role="alert"]')].map((el) => el.textContent)).toContain('Enter a whole number from 1 to 4096')
  await userEvent.fill(field('ledCount'), '144')
  await userEvent.tab()
  expect(activeDevice.value.ledCount).toBe(144)
})

it('shows the universe only for Art-Net and sACN', async () => {
  mount()
  openSettings('devices')
  await expect.poll(() => view()).not.toBeNull()
  expect(field('universe')).toBeNull()
  await userEvent.selectOptions(view()!.querySelector('select')!, 'artnet')
  expect(activeDevice.value.protocol).toBe('artnet')
  expect(field('universe')).not.toBeNull()
})

it('lists commands with their accelerators, including ones that cannot run here, and filters them', async () => {
  mount()
  openSettings('shortcuts')
  await expect.poll(() => view()).not.toBeNull()
  const row = (id: string) => view()!.querySelector<HTMLElement>(`tr[data-command="${id}"]`)
  expect(row('view.toggleDock')!.textContent).toContain('Side Panel')
  expect(row('view.toggleDock')!.querySelector('kbd')!.textContent).toBe(formatAccelerator('Mod+B'))
  // no handler is bound in this test and the app is in shader mode: both still belong in a reference
  expect(row('file.save')!.querySelector('kbd')!.textContent).toBe(formatAccelerator('Mod+S'))
  expect(row('graph.fitView')!.textContent).toContain('Graph mode')
  expect([...row('graph.delete')!.querySelectorAll('kbd')].map((el) => el.textContent)).toEqual(['X', 'Backspace', 'Delete'].map((key) => formatAccelerator(key)))
  expect(view()!.querySelector('table button, table input')).toBeNull()

  await userEvent.fill(view()!.querySelector<HTMLInputElement>('input[type="search"]')!, 'side panel')
  expect([...view()!.querySelectorAll('tr[data-command]')].map((el) => (el as HTMLElement).dataset.command)).toEqual(['view.toggleDock', 'view.hideDock'])
})

it('appearance choices land in the preferences and on the document', async () => {
  const root = document.createElement('div')
  const stop = applyPreferences(root)
  mount()
  openSettings('appearance')
  await expect.poll(() => view()).not.toBeNull()
  expect(root.dataset.density).toBe('default')
  await userEvent.click([...view()!.querySelectorAll<HTMLElement>('[role="radio"]')].find((el) => el.textContent!.trim() === 'Compact')!)
  expect(preferences.density).toBe('compact')
  await userEvent.click(view()!.querySelector<HTMLElement>('[role="switch"]')!)
  expect(preferences.reduceMotion).toBe(true)
  await nextTick()
  expect(root.dataset.density).toBe('compact')
  expect(root.hasAttribute('data-reduce-motion')).toBe(true)
  expect(root.style.getPropertyValue('--app-editor-font-size')).toBe('14px')
  stop()
})

it('asks before resetting saved data', async () => {
  mount()
  openSettings('data')
  await expect.poll(() => view()).not.toBeNull()
  expect(action('confirm-reset')).toBeNull()
  await userEvent.click(action('reset'))
  expect(action('confirm-reset')).not.toBeNull()
  expect(view()!.querySelector('[role="alert"]')!.textContent).toContain('cannot be undone')
})

it('Escape closes and hands focus back to what opened it', async () => {
  const opener = mount()
  await userEvent.click(opener)
  await expect.poll(() => view()).not.toBeNull()
  expect(view()!.contains(document.activeElement)).toBe(true)
  await userEvent.keyboard('{Escape}')
  await expect.poll(() => view()).toBeNull()
  expect(settingsView.open).toBe(false)
  expect(document.activeElement).toBe(opener)
})

it('a section headline stands alone: no description under it, while rows keep theirs', async () => {
  mount()
  openSettings('general')
  await expect.poll(() => view()).not.toBeNull()
  for (const label of ['General', 'Appearance', 'Devices', 'Output', 'Shortcuts', 'Data']) {
    await userEvent.click(tab(label))
    const header = view()!.querySelector('header')!
    expect([...header.children].filter((el) => !el.classList.contains('sr-only')).map((el) => el.textContent!.trim())).toEqual([label, 'Done'])
  }
  await userEvent.click(tab('General'))
  expect(view()!.querySelectorAll('.pref-hint').length).toBeGreaterThan(3)
})

it('General holds the launch screen switch and the audio source the app starts on', async () => {
  mount()
  openSettings('general')
  await expect.poll(() => view()).not.toBeNull()
  const launch = view()!.querySelector<HTMLElement>('[role="switch"][data-field="showLaunchScreen"]')!
  expect(launch.getAttribute('aria-checked')).toBe('true')
  await userEvent.click(launch)
  expect(preferences.showLaunchScreen).toBe(false)

  const source = view()!.querySelector<HTMLSelectElement>('[data-field="audioSource"] select')!
  expect([...source.options].map((option) => option.value)).toEqual(['file', 'device', 'loopback'])
  await userEvent.selectOptions(source, 'device')
  expect(preferences.audioSource).toBe('device')
  expect(action('audio.builtIn').disabled).toBe(true)
})
