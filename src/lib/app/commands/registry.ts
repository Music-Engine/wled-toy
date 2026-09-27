import { computed, reactive, ref, shallowReactive } from 'vue'
import { acceleratorKbds, inEditableTarget, matchesAccelerator, parseAccelerator } from './accelerators'
import { report } from '@/lib/app/logs'
import { isMac } from '@/lib/app/platform'
import { workspace, type Mode } from '@/lib/app/workspace'

export interface Command {
  id: string
  title: string | (() => string)
  /** Where the command shows: the top-level menu, then any submenus. */
  menu: string[]
  /** Neighbours in one menu with different groups get a separator between them. */
  group?: string
  /**
   * `Mod+Shift+Enter`: Mod is Cmd on macOS and Ctrl elsewhere, Ctrl is Ctrl everywhere; the key is a character, a digit,
   * a `KeyboardEvent.key` name or `NumpadDecimal`.
   */
  accelerator?: string
  aliases?: string[]
  /** The modes the command exists in; every mode when absent. */
  modes?: Mode[]
  when?: () => boolean
  enabled?: () => boolean
  checked?: () => boolean
  /** Text fields and the code editor answer this key themselves: the dispatcher leaves it to them and the native menu does not bind it. */
  textKey?: boolean
  /** Belongs to a context menu: the menubar, the native menu and the palette leave it out, the shortcut list still names its key. */
  contextOnly?: boolean
  /** Absent when a component binds the handler with `registerHandlers`; until then the command is disabled. */
  run?: () => unknown
}

/** A run of commands computed from live state (saved devices, recent files); members need no accelerator. */
export interface CommandList {
  id: string
  list: () => Command[]
}

export interface MenuItem {
  type: 'item'
  command: Command
}

export interface MenuSeparator {
  type: 'separator'
}

export interface Submenu {
  type: 'submenu'
  title: string
  items: MenuNode[]
}

export type MenuNode = MenuItem | MenuSeparator | Submenu

const registered = shallowReactive<Array<Command | CommandList>>([])
const handlers = shallowReactive(new Map<string, () => unknown>())

/** Adds commands in menu order. An id that exists already is replaced where it stands, which is how a placeholder gets its real command. */
export function registerCommands(entries: Array<Command | CommandList>): () => void {
  for (const entry of entries) {
    const at = registered.findIndex((existing) => existing.id === entry.id)
    if (at < 0) registered.push(entry)
    else registered[at] = entry
  }
  return () => {
    for (const entry of entries) {
      const at = registered.indexOf(entry)
      if (at >= 0) registered.splice(at, 1)
    }
  }
}

/** Binds what commands do to functions a component owns, for as long as it wants them bound. */
export function registerHandlers(map: Record<string, () => unknown>): () => void {
  for (const [id, handler] of Object.entries(map)) handlers.set(id, handler)
  return () => {
    for (const [id, handler] of Object.entries(map)) if (handlers.get(id) === handler) handlers.delete(id)
  }
}

/** Runs a command the way every surface does. False when it is hidden, disabled or unknown. */
export function runCommand(id: string): boolean {
  const command = getCommand(id)
  if (!command || !isVisible(command) || !isEnabled(command)) return false
  const run = handlers.get(id) ?? command.run!
  // async so a handler that throws before its first await is reported the same way as one that rejects
  void (async () => run())().catch((error) => report(error, `command ${id}`))
  return true
}

export const commands = computed(() => registered.flatMap((entry) => ('list' in entry ? entry.list() : entry)))

export const palette = reactive({ open: false, view: 'commands' as 'commands' | 'shortcuts' })

export const getCommand = (id: string) => commands.value.find((command) => command.id === id)
export const commandTitle = (command: Command) => (typeof command.title === 'function' ? command.title() : command.title)
export const isVisible = (command: Command) => (!command.modes || command.modes.includes(workspace.mode)) && (command.when?.() ?? true)
export const isEnabled = (command: Command) => (handlers.has(command.id) || !!command.run) && (command.enabled?.() ?? true)
export const isChecked = (command: Command) => command.checked?.() ?? false

/** The visible commands as menus: submenus stand where their first command does. */
export function menuTree(): Submenu[] {
  const root: Submenu = { type: 'submenu', title: '', items: [] }
  const lastGroup = new Map<Submenu, string | undefined>()
  const append = (menu: Submenu, node: MenuNode, group: string | undefined) => {
    if (menu !== root && menu.items.length && lastGroup.get(menu) !== group) menu.items.push({ type: 'separator' })
    lastGroup.set(menu, group)
    menu.items.push(node)
  }
  for (const command of commands.value) {
    if (command.contextOnly || !isVisible(command)) continue
    let menu = root
    for (const title of command.menu) {
      let next = menu.items.find((node): node is Submenu => node.type === 'submenu' && node.title === title)
      if (!next) {
        next = { type: 'submenu', title, items: [] }
        append(menu, next, command.group)
      }
      menu = next
    }
    append(menu, { type: 'item', command }, command.group)
  }
  return root.items as Submenu[]
}

/** Context menu groups in the item shape of Nuxt UI's `UContextMenu` and `UDropdownMenu`; hidden and unknown ids drop out. */
export function contextMenuItems(groups: string[][]) {
  return groups
    .map((ids) => ids.flatMap((id) => {
      const command = getCommand(id)
      if (!command || !isVisible(command)) return []
      return [{
        label: commandTitle(command),
        kbds: command.accelerator ? acceleratorKbds(command.accelerator) : undefined,
        disabled: !isEnabled(command),
        ...(command.checked ? { type: 'checkbox' as const, checked: isChecked(command) } : {}),
        onSelect: () => void runCommand(id),
      }]
    }))
    .filter((group) => group.length)
}

const nativeMenuInstalled = ref(false)

/** The desktop shell calls this once it has built the operating system's menu from `menuTree()`. */
export const markNativeMenuInstalled = (installed = true) => { nativeMenuInstalled.value = installed }

/** True when the operating system shows the menus, so the window must not draw its own. */
export const hasNativeMenu = () => nativeMenuInstalled.value

/** The accelerator a native menu item binds. It takes the key before the page sees it, so text keys and keys without Cmd/Ctrl, which text fields need, stay with the page. */
export const nativeAccelerator = (command: Command) =>
  (!command.textKey && !command.contextOnly && command.accelerator && parseAccelerator(command.accelerator).mod ? command.accelerator : undefined)

/**
 * The one place accelerators fire from. It leaves alone what somebody handled already (CodeMirror, a widget),
 * keys without Cmd/Ctrl and text keys while the user types, AltGr characters, and runs nothing for a held key or while a dialog or the node menu is up.
 * True when a command ran.
 */
export function dispatchKey(e: KeyboardEvent, mac = isMac()): boolean {
  if (e.defaultPrevented || e.getModifierState?.('AltGraph')) return false
  for (const command of commands.value) {
    if (!isVisible(command)) continue
    const hit = [command.accelerator, ...(command.aliases ?? [])].find((text) => text && matchesAccelerator(e, parseAccelerator(text), mac))
    if (!hit) continue
    // the native item runs the command; should the key reach the page as well, it must not run twice
    if (hasNativeMenu() && hit === nativeAccelerator(command)) return false
    const { mod: cmd, ctrl, key } = parseAccelerator(hit)
    const mod = cmd || ctrl
    if ((!mod || command.textKey) && inEditableTarget(e)) return false
    // Space on a focused button is that button's click
    if (!mod && key === 'space' && (e.target as Element | null)?.closest?.('button')) return false
    // text selected on the page copies and cuts as text
    if (command.textKey && (key === 'c' || key === 'x') && window.getSelection()?.toString()) return false
    const idle = e.repeat || !!document.querySelector('[role="dialog"]')
    if (idle && !mod) return false
    // a Cmd/Ctrl key of a command stays away from the browser even when nothing runs: Cmd+S must never become Save Page
    e.preventDefault()
    return !idle && runCommand(command.id)
  }
  return false
}

export function installKeyDispatcher(): () => void {
  const onKeydown = (e: KeyboardEvent) => void dispatchKey(e)
  window.addEventListener('keydown', onKeydown)
  return () => window.removeEventListener('keydown', onKeydown)
}
