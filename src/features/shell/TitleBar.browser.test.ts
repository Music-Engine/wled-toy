import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import TitleBar from './TitleBar.vue'
import { markNativeMenuInstalled, registerHandlers } from '@/lib/app/commands'
import { useEngine } from '@/lib/engine/engine'
import { resetLayout, workspace } from '@/lib/app/workspace'

const platform = Object.getOwnPropertyDescriptor(Navigator.prototype, 'platform')!
const setPlatform = (value: string) => Object.defineProperty(navigator, 'platform', { value, configurable: true })

let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  markNativeMenuInstalled(false)
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  delete (navigator as { platform?: string }).platform
  expect(Object.getOwnPropertyDescriptor(Navigator.prototype, 'platform')).toEqual(platform)
  workspace.mode = 'shader'
  if (useEngine().streaming.value) useEngine().toggleStream()
  resetLayout()
})

function mount() {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(TitleBar) })
  // Nuxt UI is not installed here: its wrappers render as unknown elements that still show their default slot
  app.config.warnHandler = () => undefined
  app.mount(root)
  unmount = () => { app.unmount(); root.remove() }
  return root.querySelector<HTMLElement>('header')!
}

it('has no icon-only button outside the layout toggles', () => {
  const bar = mount()
  const buttons = [...bar.querySelectorAll('button')].filter((b) => !b.closest('.layout-toggles'))
  expect(buttons.map((b) => b.textContent!.trim())).toEqual(['File', 'View', 'Help', 'Shader', 'Graph', 'Reference'])
})

it('holds the menus, the mode tabs and the layout toggles; playback and devices live in the status bar', () => {
  const bar = mount()
  const order = [...bar.children].map((el) => ['app-menubar', 'mode-tabs', 'layout-toggles'].find((name) => el.classList.contains(name))).filter(Boolean)
  expect(order).toEqual(['app-menubar', 'mode-tabs', 'layout-toggles'])
  expect(bar.querySelector('.transport, .output')).toBeNull()
  expect([...bar.querySelectorAll('.mode-tabs [role="tab"]')].map((tab) => tab.textContent!.trim())).toEqual(['Shader', 'Graph', 'Reference'])
  expect(bar.querySelector('.mode-tabs svg, .mode-tabs [class*="i-lucide"]')).toBeNull()
  expect(document.querySelector('nav')).toBeNull()
})

it('the selected tab follows the mode, and a tab runs its mode command', async () => {
  const toGraph = vi.fn(() => { workspace.mode = 'graph' })
  const release = registerHandlers({ 'mode.graph': toGraph })
  const bar = mount()
  const [shader, graph, reference] = bar.querySelectorAll<HTMLButtonElement>('.mode-tabs [role="tab"]')
  expect([shader, graph, reference].map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
  expect(shader.classList.contains('bg-accented')).toBe(true)
  // nothing bound the Reference command here, so its tab cannot pretend to work
  expect([graph.disabled, reference.disabled]).toEqual([false, true])
  graph.click()
  await nextTick()
  expect(toGraph).toHaveBeenCalledOnce()
  expect([shader, graph, reference].map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
  expect([shader.classList.contains('bg-accented'), graph.classList.contains('bg-accented')]).toEqual([false, true])
  release()
})

it('draws its own menubar, under Tauri on macOS too, until the shell reports a native menu', async () => {
  setPlatform('MacIntel')
  ;(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  const bar = mount()
  expect(bar.querySelector('.app-menubar')).not.toBeNull()
  markNativeMenuInstalled()
  await nextTick()
  expect(bar.querySelector('.app-menubar')).toBeNull()
})

it('is a plain toolbar in the browser: no drag regions, no traffic light spacer', () => {
  const bar = mount()
  expect(bar.parentElement!.querySelectorAll('[data-tauri-drag-region]').length).toBe(0)
  expect(bar.querySelector('.traffic-spacer')).toBeNull()
})

it('under Tauri on Windows and Linux the native decorations drag the window: no drag regions, no traffic light spacer', () => {
  setPlatform('Win32')
  ;(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  const bar = mount()
  expect(bar.parentElement!.querySelectorAll('[data-tauri-drag-region]').length).toBe(0)
  expect(bar.querySelector('.traffic-spacer')).toBeNull()
})

it('under Tauri on macOS the bar, the spacer and both empty slots drag the window, and no control does', () => {
  setPlatform('MacIntel')
  ;(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  const bar = mount()
  expect(bar.hasAttribute('data-tauri-drag-region')).toBe(true)
  expect(bar.firstElementChild!.classList.contains('traffic-spacer')).toBe(true)
  expect(bar.querySelectorAll('.app-menubar [data-tauri-drag-region], .mode-tabs [data-tauri-drag-region]').length).toBe(0)
  const regions = [...bar.querySelectorAll('[data-tauri-drag-region]')]
  expect(regions.length).toBe(3)
  expect(regions.every((el) => el.children.length === 0)).toBe(true)
  expect(bar.querySelectorAll('button[data-tauri-drag-region], .transport[data-tauri-drag-region], .output[data-tauri-drag-region]').length).toBe(0)
})

it('going live draws the hairline across the bar', async () => {
  const bar = mount()
  expect(bar.querySelector('.live-hairline')).toBeNull()
  useEngine().toggleStream()
  await nextTick()
  expect(bar.querySelector('.live-hairline')).not.toBeNull()
})

it('the layout toggles show and flip the visibility of the right dock and the bottom panel', async () => {
  const bar = mount()
  const [dock, bottom] = bar.querySelectorAll<HTMLButtonElement>('.layout-toggles button')
  expect([dock.getAttribute('aria-pressed'), bottom.getAttribute('aria-pressed')]).toEqual(['true', 'false'])
  expect(dock.disabled || bottom.disabled).toBe(false)
  dock.click()
  bottom.click()
  await nextTick()
  expect([workspace.dockVisible, workspace.bottomVisible]).toEqual([false, true])
  expect([dock.getAttribute('aria-pressed'), bottom.getAttribute('aria-pressed')]).toEqual(['false', 'true'])
  expect([dock.classList.contains('bg-accented'), bottom.classList.contains('bg-accented')]).toEqual([false, true])
})
