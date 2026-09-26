import { afterEach, beforeEach, vi } from 'vitest'
import { markNativeMenuInstalled } from '@/lib/app/commands'
import { useEngine } from '@/lib/engine/engine'
import type { MenuApi } from '@/lib/native/native-menu'
import { resetLayout, workspace } from '@/lib/app/workspace'

export const setPlatform = (value: string) => Object.defineProperty(navigator, 'platform', { value, configurable: true })
export const setTauri = (on: boolean) => {
  if (on) (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  else delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
}

/** Runs after each test, in the order pushed. */
export const cleanups: Array<() => void> = []

/** The desktop app on macOS for every test of the file: app.quit exists under Tauri only, and the menu is installed on macOS only. */
export function useMacDesktop() {
  beforeEach(() => {
    // checked state reads the engine, whose bridge must pick its transport before the page claims to be a Tauri window
    useEngine()
    setTauri(true)
    setPlatform('MacIntel')
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanups.splice(0).forEach((cleanup) => cleanup())
    markNativeMenuInstalled(false)
    setTauri(false)
    delete (navigator as { platform?: string }).platform
    resetLayout()
    workspace.mode = 'shader'
  })
}

interface FakeNode {
  kind: 'Menu' | 'Submenu' | 'MenuItem' | 'CheckMenuItem' | 'Predefined'
  options: { id?: string; text?: string; enabled?: boolean; checked?: boolean; accelerator?: string; item?: string; items?: FakeNode[]; action?: () => void }
  closed: boolean
}

/** Stands in for `@tauri-apps/api/menu`: remembers what was built, which menu is the app menu, and every call that changed an item. */
export function fakeMenuApi() {
  const created: FakeNode[] = []
  const calls: string[] = []
  const state = { appMenu: null as FakeNode | null, windowsMenu: null as FakeNode | null, helpMenu: null as FakeNode | null }
  const make = (kind: FakeNode['kind'], options: object) => {
    const node: FakeNode = { kind, options: { ...options }, closed: false }
    created.push(node)
    return {
      node,
      close: async () => { node.closed = true },
      setText: async (text: string) => { calls.push(`setText ${node.options.id} ${text}`); node.options.text = text },
      setEnabled: async (enabled: boolean) => { calls.push(`setEnabled ${node.options.id} ${enabled}`); node.options.enabled = enabled },
      setChecked: async (checked: boolean) => { calls.push(`setChecked ${node.options.id} ${checked}`); node.options.checked = checked },
      setAsAppMenu: async () => {
        const replaced = state.appMenu
        state.appMenu = node
        return replaced ? { close: async () => undefined } : null
      },
      setAsWindowsMenuForNSApp: async () => { state.windowsMenu = node },
      setAsHelpMenuForNSApp: async () => { state.helpMenu = node },
    }
  }
  // a submenu gets the handles `new` returned; the fake keeps the nodes behind them
  const nodesOf = (options: { items?: unknown[] }) => ({ ...options, items: (options.items as { node: FakeNode }[] | undefined)?.map((handle) => handle.node) })
  const api: MenuApi = {
    Menu: { new: async (options = {}) => make('Menu', nodesOf(options)) },
    Submenu: { new: async (options) => make('Submenu', nodesOf(options)) },
    MenuItem: { new: async (options) => make('MenuItem', options) },
    CheckMenuItem: { new: async (options) => make('CheckMenuItem', options) },
    PredefinedMenuItem: { new: async (options) => make('Predefined', options) },
  }
  const find = (id: string, from: FakeNode[] = state.appMenu?.options.items ?? []): FakeNode | undefined =>
    from.flatMap((node) => (node.options.id === id ? [node] : node.options.items ? [find(id, node.options.items)] : [])).find(Boolean)
  const submenu = (...path: string[]) => path.reduce<FakeNode | undefined>((menu, text) => menu?.options.items?.find((node) => node.kind === 'Submenu' && node.options.text === text), state.appMenu ?? undefined)
  const outline = (menu: FakeNode | undefined) => menu?.options.items?.map((node) =>
    (node.kind === 'Predefined' ? `<${node.options.item}>` : node.kind === 'Submenu' ? `${node.options.text} >` : `${node.options.text}${node.options.accelerator ? ` [${node.options.accelerator}]` : ''}`))
  /** What the system does on a click: a check item flips its own mark before the action runs. */
  const click = (id: string) => {
    const node = find(id)!
    if (node.kind === 'CheckMenuItem') node.options.checked = !node.options.checked
    node.options.action!()
  }
  const built = (kind: FakeNode['kind']) => created.filter((node) => node.kind === kind)
  return { api, state, calls, created, find, submenu, outline, click, built }
}
