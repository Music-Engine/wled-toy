import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type Component } from 'vue'
import InputsInspector from './InputsInspector.vue'
import { registerHandlers } from '@/lib/app/commands'
import { useEngine } from '@/lib/engine/engine'

let unmount: (() => void) | undefined
afterEach(async () => {
  unmount?.()
  useEngine().audio.state.error = null
  await useEngine().useImage(null, false)
  await useEngine().useSong(null, false)
})

function mount(component: Component) {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(component) })
  app.mount(root)
  unmount = () => { app.unmount(); root.remove() }
  return root
}

it('shows the audio error, which nothing else in the window does', async () => {
  const root = mount(InputsInspector)
  expect(root.querySelector('.audio-error')).toBeNull()
  useEngine().audio.state.error = 'Permission to capture audio was refused'
  await nextTick()
  expect(root.querySelector('.audio-error')!.textContent).toBe('Permission to capture audio was refused')
})

it('names the song and the image in use, and Use built-in goes back to the built-in ones', async () => {
  const engine = useEngine()
  await engine.useSong({ blob: new Blob(['x']), name: 'mine.mp3' }, false)
  await engine.useImage({ blob: new Blob(['x']), name: 'mine.png' }, false)
  const root = mount(InputsInspector)
  const shown = () => [root.querySelector('[data-value="track"]')!.textContent, root.querySelector('[data-value="image"]')!.textContent]
  expect(shown()).toEqual(['mine.mp3', 'mine.png'])

  root.querySelector<HTMLElement>('[data-action="audio.builtIn"]')!.click()
  root.querySelector<HTMLElement>('[data-action="image.builtIn"]')!.click()
  await vi.waitFor(() => expect(shown()).toEqual(['Built-in track', 'Built-in image']))
})

it('Choose... runs the registry commands instead of owning a file input', () => {
  const chooseSong = vi.fn()
  const chooseImage = vi.fn()
  const release = registerHandlers({ 'audio.fromFile': chooseSong, 'image.fromFile': chooseImage })
  const root = mount(InputsInspector)
  try {
    root.querySelector<HTMLElement>('[data-action="audio.fromFile"]')!.click()
    root.querySelector<HTMLElement>('[data-action="image.fromFile"]')!.click()
    expect([chooseSong.mock.calls.length, chooseImage.mock.calls.length]).toEqual([1, 1])
    expect(root.querySelector('input[type="file"]')).toBeNull()
  } finally {
    release()
  }
})

it('the macOS desktop app cannot capture system audio: the choice is disabled and says what to do instead', async () => {
  Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
  ;(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  try {
    const root = mount(InputsInspector)
    const system = root.querySelector<HTMLButtonElement>('[data-source="loopback"]')!
    expect(system.disabled).toBe(true)
    expect(system.title).toContain('BlackHole')
    expect(root.querySelector('.system-audio-note')!.textContent).toContain('not available in the desktop app yet')
    expect(root.querySelector<HTMLButtonElement>('[data-source="device"]')!.disabled).toBe(false)
  } finally {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    delete (navigator as { platform?: string }).platform
  }
  unmount?.()
  const root = mount(InputsInspector)
  expect(root.querySelector<HTMLButtonElement>('[data-source="loopback"]')!.disabled).toBe(false)
  expect(root.querySelector('.system-audio-note')).toBeNull()
})

it('missing MIDI is worded for where the app runs', async () => {
  const midi = useEngine().midi.state
  const available = midi.available
  midi.available = false
  try {
    expect(mount(InputsInspector).querySelector('.midi-unavailable')!.textContent).toBe('This browser has no Web MIDI.')
    unmount?.()
    ;(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
    expect(mount(InputsInspector).querySelector('.midi-unavailable')!.textContent).toBe('MIDI is not available in the desktop app yet.')
  } finally {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    midi.available = available
  }
})
