import { afterEach, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createApp, h, ref } from 'vue'
import AboutDialog from './AboutDialog.vue'
import { version } from '@/lib/app/version'

let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
})

function mount() {
  const open = ref(true)
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(AboutDialog, { open: open.value, 'onUpdate:open': (value: boolean) => { open.value = value } }) })
  app.mount(root)
  unmount = () => { app.unmount(); root.remove() }
  return open
}

const dialog = () => document.querySelector<HTMLElement>('.about-dialog')

it('says what the app is, what it does, which version runs and who developed it', async () => {
  mount()
  await expect.poll(() => dialog()).not.toBeNull()
  const text = dialog()!.textContent!
  expect(dialog()!.querySelector('h2')!.textContent).toBe('WLEDtoy')
  expect(dialog()!.querySelector('[data-value="version"]')!.textContent).toBe(`Version ${version}`)
  expect(text).toContain('A live shader and node-graph playground for addressable LEDs.')
  expect([...dialog()!.querySelectorAll('li')].map((el) => el.textContent)).toEqual([
    'Write GLSL or build node graphs', 'React to audio and MIDI', 'Preview on a virtual strip or matrix', 'Stream to WLED over DDP, DNRGB, Art-Net or sACN',
  ])
  const link = dialog()!.querySelector('a')!
  expect([link.textContent, link.href, link.target]).toEqual(['@omargfh', 'https://github.com/omargfh', '_blank'])
  expect(text).toContain('Developed by')
  expect(dialog()!.querySelector('img, [class*="i-lucide"]')).toBeNull()
})

it('reports the runtime and the WebGL2 renderer of this machine', async () => {
  mount()
  await expect.poll(() => dialog()).not.toBeNull()
  expect(dialog()!.querySelector('[data-value="runtime"]')!.textContent).toBe('Browser')
  // SwiftShader in the test browser; whatever it is, it is a name and not the fallback
  expect(dialog()!.querySelector('[data-value="renderer"]')!.textContent).toMatch(/\w{3,}/)
  expect(dialog()!.querySelector('[data-value="renderer"]')!.textContent).not.toBe('not available')
})

it('names the desktop app under Tauri, and Close closes', async () => {
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  const open = mount()
  await expect.poll(() => dialog()).not.toBeNull()
  expect(dialog()!.querySelector('[data-value="runtime"]')!.textContent).toBe('Desktop app (Tauri)')
  await userEvent.click([...dialog()!.querySelectorAll('button')].find((el) => el.textContent === 'Close')!)
  expect(open.value).toBe(false)
})
