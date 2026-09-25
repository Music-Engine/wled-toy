import { watch } from 'vue'
import {
  commandTitle, getCommand, isChecked, isEnabled, isMac, isVisible, markNativeMenuInstalled, menuTree, nativeAccelerator, parseAccelerator, runCommand,
  type Command, type MenuNode,
} from '@/lib/app/commands'
import { report } from '@/lib/app/logs'
import { NativeError } from './native-error'
import { isTauri } from '@/lib/app/platform'
import { workspace } from '@/lib/app/workspace'

type Predefined = 'Separator' | 'Undo' | 'Redo' | 'Cut' | 'Copy' | 'Paste' | 'Services' | 'Hide' | 'HideOthers' | 'ShowAll' | 'Minimize' | 'Maximize' | 'CloseWindow'

export interface NativeItem {
  type: 'item'
  id: string
  text: string
  enabled: boolean
  /** Present on a check item, also while it is off. */
  checked?: boolean
  accelerator?: string
}

export interface NativeSubmenu {
  type: 'submenu'
  text: string
  items: NativeNode[]
}

export type NativeNode = NativeItem | NativeSubmenu | { type: 'predefined'; item: Predefined }

interface Resource {
  close(): Promise<void>
}

interface ItemHandle extends Resource {
  setText(text: string): Promise<void>
  setEnabled(enabled: boolean): Promise<void>
}

interface ItemOptions {
  id: string
  text: string
  enabled: boolean
  accelerator?: string
  action: () => void
}

/** The part of `@tauri-apps/api/menu` the menu is built with; tests pass a fake. */
export interface MenuApi {
  Menu: { 'new'(options?: { items?: unknown[] }): Promise<Resource & { setAsAppMenu(): Promise<Resource | null> }> }
  Submenu: { 'new'(options: { text: string; items?: unknown[] }): Promise<Resource & { setAsWindowsMenuForNSApp(): Promise<void>; setAsHelpMenuForNSApp(): Promise<void> }> }
  MenuItem: { 'new'(options: ItemOptions): Promise<ItemHandle> }
  CheckMenuItem: { 'new'(options: ItemOptions & { checked: boolean }): Promise<ItemHandle & { setChecked(checked: boolean): Promise<void> }> }
  PredefinedMenuItem: { 'new'(options: { item: Predefined }): Promise<Resource> }
}

/** `Mod+Alt+S` as muda reads it: `CmdOrCtrl+Alt+S`. */
export function toNativeAccelerator(text: string): string {
  const { mod, shift, alt, key } = parseAccelerator(text)
  return [...(mod ? ['CmdOrCtrl'] : []), ...(alt ? ['Alt'] : []), ...(shift ? ['Shift'] : []), key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1)].join('+')
}

const predefined = (item: Predefined): NativeNode => ({ type: 'predefined', item })

const isSeparator = (node: NativeNode | undefined) => node?.type === 'predefined' && node.item === 'Separator'

/** Items that moved to the app menu can leave a separator at an end of a menu, or two in a row. */
function withoutStraySeparators(nodes: NativeNode[]): NativeNode[] {
  const kept: NativeNode[] = []
  for (const node of nodes) if (!isSeparator(node) || (kept.length && !isSeparator(kept.at(-1)))) kept.push(node)
  if (isSeparator(kept.at(-1))) kept.pop()
  return kept
}

function nativeItem(command: Command): NativeItem {
  const accelerator = nativeAccelerator(command)
  return {
    type: 'item',
    id: command.id,
    text: commandTitle(command),
    enabled: isEnabled(command),
    ...(command.checked ? { checked: isChecked(command) } : {}),
    ...(accelerator ? { accelerator: toNativeAccelerator(accelerator) } : {}),
  }
}

/**
 * The macOS menu bar: the app menu, then the registry's menus with Edit after File and Window before Help.
 * About, Preferences and Quit sit in the app menu there, so they leave the menus the registry put them in.
 * Edit ends in a Select All of our own: the predefined item would take Cmd+A and send the webview's `selectAll:` action,
 * which raises no event a page can act on, so the graph could never select its nodes. The predefined Cut keeps Cmd+X,
 * which is what lets text fields cut in the webview; on the canvas its cut event dissolves nodes, as Cmd+X does in Blender.
 */
export function nativeMenuModel(): NativeSubmenu[] {
  const inAppMenu = ['help.about', 'app.preferences', 'app.quit']
  const convert = (nodes: MenuNode[]): NativeNode[] => withoutStraySeparators(nodes.flatMap((node): NativeNode[] => {
    if (node.type === 'separator') return [predefined('Separator')]
    if (node.type === 'submenu') return [{ type: 'submenu', text: node.title, items: convert(node.items) }]
    return inAppMenu.includes(node.command.id) ? [] : [nativeItem(node.command)]
  }))
  const [about, preferences, quit] = inAppMenu.map((id): NativeNode[] => {
    const command = getCommand(id)
    return command && isVisible(command) ? [nativeItem(command)] : []
  })
  const menus: NativeSubmenu[] = [{
    type: 'submenu',
    text: 'WLEDtoy',
    items: withoutStraySeparators([
      ...about, predefined('Separator'), ...preferences, predefined('Separator'), predefined('Services'), predefined('Separator'),
      predefined('Hide'), predefined('HideOthers'), predefined('ShowAll'), predefined('Separator'), ...quit,
    ]),
  }]
  for (const menu of convert(menuTree()) as NativeSubmenu[]) {
    if (menu.text === 'Help') menus.push({ type: 'submenu', text: 'Window', items: [predefined('Minimize'), predefined('Maximize'), predefined('Separator'), predefined('CloseWindow')] })
    menus.push(menu)
    if (menu.text === 'File') {
      menus.push({
        type: 'submenu',
        text: 'Edit',
        items: [
          { type: 'item', id: 'edit.undo', text: 'Undo', enabled: true, accelerator: 'CmdOrCtrl+Z' },
          { type: 'item', id: 'edit.redo', text: 'Redo', enabled: true, accelerator: 'CmdOrCtrl+Shift+Z' },
          predefined('Separator'), predefined('Cut'), predefined('Copy'), predefined('Paste'),
          { type: 'item', id: 'edit.selectAll', text: 'Select All', enabled: true, accelerator: 'CmdOrCtrl+A' },
        ],
      })
    }
  }
  return menus
}

const itemsOf = (nodes: NativeNode[]): NativeItem[] => nodes.flatMap((node) => (node.type === 'item' ? [node] : node.type === 'submenu' ? itemsOf(node.items) : []))

// what cannot be patched: which items exist, where, of which kind and on which key
const structureOf = (nodes: NativeNode[]): unknown[] => nodes.map((node) =>
  (node.type === 'item' ? [node.id, node.accelerator, node.checked !== undefined] : node.type === 'submenu' ? [node.text, structureOf(node.items)] : node.item))

/**
 * What a native item does. Undo, Redo and Select All go to whatever holds the text cursor; without one they act on
 * the graph, and do nothing in the other modes. The predefined Undo and Redo only ever reach text, which left them dead in a graph.
 */
export function runNativeItem(id: string) {
  if (id === 'edit.undo' || id === 'edit.redo') return runHistoryItem(id === 'edit.undo' ? 'undo' : 'redo')
  if (id !== 'edit.selectAll') return runCommand(id)
  const focused = document.activeElement
  if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) return focused.select()
  const editable = focused?.closest('[contenteditable="true"]')
  // CodeMirror's content is such an element and reads the selection back from the DOM; an editor that binds shader.selectAll gets to do it itself
  if (editable) return (editable.closest('.cm-editor') && runCommand('shader.selectAll')) || getSelection()?.selectAllChildren(editable)
  return workspace.mode === 'graph' && runCommand('graph.selectAll')
}

function runHistoryItem(step: 'undo' | 'redo') {
  const focused = document.activeElement
  // CodeMirror keeps its own history; the browser's would not know its edits
  if (focused?.closest('.cm-editor')) return runCommand(`shader.${step}`)
  if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement || focused?.closest('[contenteditable="true"]')) return document.execCommand(step)
  return workspace.mode === 'graph' && runCommand(`graph.${step}`)
}

export function createNativeMenu(api: MenuApi, run: (id: string) => unknown = runNativeItem) {
  let structure = ''
  let resources: Resource[] = []
  let handles = new Map<string, ItemHandle & { setChecked?(checked: boolean): Promise<void> }>()
  let applied = new Map<string, Partial<NativeItem>>()
  let queue: Promise<void> = Promise.resolve()
  const reportFailure = (cause: unknown) => report(new NativeError('menu-sync', 'The system menu could not be updated', cause))

  /** Resolves to what the menu it replaced was made of, for the caller to release. */
  async function build(model: NativeSubmenu[]): Promise<Resource[]> {
    const created: Resource[] = []
    const keep = <T extends Resource>(resource: T) => {
      created.push(resource)
      return resource
    }
    const nextHandles: typeof handles = new Map()
    const nextApplied: typeof applied = new Map()
    const make = async (node: NativeNode): Promise<Resource> => {
      if (node.type === 'predefined') return keep(await api.PredefinedMenuItem.new({ item: node.item }))
      if (node.type === 'submenu') {
        const submenu = keep(await api.Submenu.new({ text: node.text, items: await Promise.all(node.items.map(make)) }))
        if (node.text === 'Window') await submenu.setAsWindowsMenuForNSApp()
        if (node.text === 'Help') await submenu.setAsHelpMenuForNSApp()
        return submenu
      }
      const options: ItemOptions = {
        id: node.id,
        text: node.text,
        enabled: node.enabled,
        accelerator: node.accelerator,
        action() {
          void run(node.id)
          if (node.checked === undefined) return
          // the system flipped the check mark on its own; the command's state decides, also when the click changed nothing
          delete applied.get(node.id)?.checked
          sync().catch(reportFailure)
        },
      }
      const handle = keep(node.checked === undefined ? await api.MenuItem.new(options) : await api.CheckMenuItem.new({ ...options, checked: node.checked }))
      nextHandles.set(node.id, handle)
      nextApplied.set(node.id, { ...node })
      return handle
    }
    const menu = keep(await api.Menu.new({ items: await Promise.all(model.map(make)) }))
    const replaced = await menu.setAsAppMenu()
    const old = [...resources, ...(replaced ? [replaced] : [])]
    resources = created
    handles = nextHandles
    applied = nextApplied
    return old
  }

  async function patch(model: NativeSubmenu[]) {
    for (const item of itemsOf(model)) {
      const handle = handles.get(item.id)!
      const was = applied.get(item.id)!
      if (was.text !== item.text) await handle.setText(item.text)
      if (was.enabled !== item.enabled) await handle.setEnabled(item.enabled)
      if (was.checked !== item.checked) await handle.setChecked!(item.checked!)
      applied.set(item.id, { ...item })
    }
  }

  /** Brings the system menu in line with the registry: item state is patched in place, anything else rebuilds the menu. */
  function sync(): Promise<void> {
    // whoever awaited the previous sync reported its failure; dropping it here keeps one failure from stopping every later sync
    queue = queue.catch(() => undefined).then(async () => {
      const model = nativeMenuModel()
      const next = JSON.stringify(structureOf(model))
      if (next === structure) return patch(model)
      const old = await build(model)
      structure = next
      await Promise.all(old.map((resource) => resource.close()))
    })
    return queue
  }

  return { sync, report: reportFailure }
}

/** macOS only: Windows and Linux keep the menubar the window draws. */
export async function installNativeMenu(load: () => Promise<MenuApi> = () => import('@tauri-apps/api/menu')): Promise<void> {
  if (!isTauri() || !isMac()) return
  const menu = createNativeMenu(await load())
  await menu.sync()
  markNativeMenuInstalled()
  let timer: ReturnType<typeof setTimeout> | undefined
  watch(() => JSON.stringify(nativeMenuModel()), () => {
    clearTimeout(timer)
    timer = setTimeout(() => menu.sync().catch(menu.report), 50)
  })
}
