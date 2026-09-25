import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { KeepAlive, createApp, h } from 'vue'
import ShaderPage from './ShaderPage.vue'
import TitleBar from '@/features/shell/TitleBar.vue'
import { installKeyDispatcher, isMac, runCommand } from '@/lib/app/commands'
import { config } from '@/lib/app/config'
import type { FileBackend } from '@/lib/documents/documents'
import { shaderFileBackendKey } from '@/lib/shader/shader-document'
import { dockHost, workspace } from '@/lib/app/workspace'

const code = config.code
let unmount: (() => void) | undefined
const clearStored = () => ['wledtoy:shader:recent', 'wledtoy:shader:recovery'].forEach((key) => localStorage.removeItem(key))

beforeEach(clearStored)
afterEach(() => {
  unmount?.()
  unmount = undefined
  config.code = code
  clearStored()
})

/** The disk and its dialogs: `pick` is the file the user chooses in the Open dialog. */
function fakeDisk(files: Record<string, string>) {
  const state = { pick: null as string | null, opened: [] as unknown[][] }
  const backend: FileBackend = {
    open: async (...args) => {
      state.opened.push(args)
      return state.pick === null ? null : { handle: { name: state.pick }, text: files[state.pick] }
    },
    save: async (handle, text) => { files[handle.name] = text },
    saveAs: async (text, suggestedName) => {
      files[suggestedName] = text
      return { handle: { name: suggestedName }, text }
    },
  }
  return { files, state, backend }
}

function mount(backend: FileBackend = fakeDisk({}).backend) {
  workspace.mode = 'shader'
  const root = document.createElement('div')
  root.style.height = '200px'
  document.body.append(root)
  const app = createApp({ render: () => [h(TitleBar), h(KeepAlive, () => h(ShaderPage))] })
  app.provide(shaderFileBackendKey, backend)
  // Nuxt UI and the auto-imported components are not installed here; the editor and the problems list do not need them
  app.config.warnHandler = () => undefined
  app.mount(root)
  const removeKeys = installKeyDispatcher()
  unmount = () => { removeKeys(); app.unmount(); root.remove() }
  return root
}

const titleBarText = () => document.querySelector('.document-name')?.textContent?.replace(/\s+/g, ' ').trim()

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  // CodeMirror resolves a shifted letter through the legacy key code
  const event = new KeyboardEvent('keydown', { key, keyCode: key.toUpperCase().charCodeAt(0), bubbles: true, cancelable: true, ...(isMac() ? { metaKey: true } : { ctrlKey: true }), ...init } as KeyboardEventInit)
  target.dispatchEvent(event)
  return event
}

const FIRE = 'void mainImage(out vec4 c, vec2 uv, float ledIndex) {\n  c = vec4(heatColor(uv.x), 1.0);\n}\n'

it('opens a .glsl file, marks an edit, and Cmd+S writes the source back as it was typed', async () => {
  const disk = fakeDisk({ 'fire.glsl': FIRE })
  const root = mount(disk.backend)
  await expect.poll(titleBarText).toBe('Untitled')

  disk.state.pick = 'fire.glsl'
  expect(runCommand('file.open')).toBe(true)
  await expect.poll(titleBarText).toBe('fire.glsl')
  expect(disk.state.opened).toEqual([['.glsl', ['.frag', '.fs']]])
  expect(config.code).toBe(FIRE)
  await expect.poll(() => root.querySelector('.cm-content')?.textContent).toContain('heatColor')
  expect(titleBarText()).toBe('fire.glsl')
  expect(document.title).toMatch(/^fire\.glsl - /)

  const edited = FIRE.replace('heatColor', 'rainbow')
  config.code = edited
  await expect.poll(titleBarText).toBe('fire.glsl · Edited')
  expect(document.title).toMatch(/^fire\.glsl \(edited\) - /)

  const event = press(root.querySelector('.cm-content')!, 's')
  expect(event.defaultPrevented).toBe(true)
  await expect.poll(titleBarText).toBe('fire.glsl')
  expect(disk.files['fire.glsl']).toBe(edited)
})

it('a held Cmd+S never reaches the browser and saves nothing', async () => {
  const disk = fakeDisk({})
  const save = vi.spyOn(disk.backend, 'saveAs')
  const root = mount(disk.backend)
  await expect.poll(titleBarText).toBe('Untitled')
  expect(press(root.querySelector('.cm-content')!, 's', { repeat: true }).defaultPrevented).toBe(true)
  expect(save).not.toHaveBeenCalled()
})

it('a file with Windows line ends opens unedited', async () => {
  const disk = fakeDisk({ 'dos.frag': FIRE.replace(/\n/g, '\r\n') })
  mount(disk.backend)
  await expect.poll(titleBarText).toBe('Untitled')
  disk.state.pick = 'dos.frag'
  runCommand('file.open')
  await expect.poll(titleBarText).toBe('dos.frag')
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(titleBarText()).toBe('dos.frag')
  expect(config.code).toBe(FIRE)
})

it('Save on an Untitled shader goes through Save As, and New Shader asks before it drops an edit', async () => {
  const disk = fakeDisk({})
  mount(disk.backend)
  await expect.poll(titleBarText).toBe('Untitled')
  runCommand('file.save')
  await expect.poll(titleBarText).toBe('shader.glsl')
  expect(disk.files['shader.glsl']).toBe(config.code)

  config.code = FIRE
  await expect.poll(titleBarText).toBe('shader.glsl · Edited')
  runCommand('file.new')
  const dialog = await vi.waitFor(() => {
    const found = document.querySelector<HTMLElement>('.shader-document-dialog')
    expect(found?.textContent).toContain('Save changes to shader.glsl?')
    return found!
  })
  dialog.querySelector<HTMLElement>('[data-choice="discard"]')!.click()
  await expect.poll(titleBarText).toBe('Untitled')
  expect(config.code).toContain('void mainImage(')
  expect(config.code).not.toBe(FIRE)
  expect(disk.files['shader.glsl']).not.toBe(FIRE)
})

it('Cmd+A selects all in the editor, and Cmd+Shift+A opens the function menu', async () => {
  config.code = FIRE
  const root = mount()
  const content = await vi.waitFor(() => {
    const found = root.querySelector<HTMLElement>('.cm-content')
    expect(found).not.toBeNull()
    return found!
  })
  content.focus()

  expect(press(content, 'a').defaultPrevented).toBe(true)
  expect(document.querySelector('.node-menu')).toBeNull()
  await expect.poll(() => document.getSelection()!.toString().replace(/\s+/g, ' ').trim()).toBe(FIRE.replace(/\s+/g, ' ').trim())

  expect(press(content, 'A', { shiftKey: true }).defaultPrevented).toBe(true)
  await expect.poll(() => document.querySelector('.node-menu')).not.toBeNull()
})

it('clicking a shader problem puts the editor cursor on its line', async () => {
  const lines = ['void mainImage(out vec4 c, vec2 uv, float ledIndex) {', ...Array.from({ length: 40 }, (_, i) => `  float v${i} = ${i}.0;`), '  c = vec4(missing, 0.0, 0.0, 1.0);', '}']
  config.code = lines.join('\n')
  const root = mount()

  const row = await vi.waitFor(() => {
    const found = dockHost('problems').querySelector<HTMLElement>('.problems-list li')
    expect(found?.textContent).toContain('line 42')
    return found!
  })
  const activeLine = () => root.querySelector('.cm-activeLine')?.textContent
  expect(activeLine()).not.toContain('missing')

  row.click()
  await vi.waitFor(() => expect(activeLine()).toContain('vec4(missing'))
  expect(root.querySelector('.cm-content')!.contains(document.activeElement)).toBe(true)
})
