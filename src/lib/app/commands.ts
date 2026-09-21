import { computed, reactive, ref, shallowReactive } from 'vue'
import { useColorMode } from '@vueuse/core'
import { systemAudioBlocked } from '@/lib/audio/service'
import { copyText } from './clipboard'
import { config, exportConfig, importConfig } from './config'
import { activeDeviceId, devices, setActiveDevice } from './devices'
import { useEngine } from '@/lib/engine/engine'
import { isStripLayout } from '@/lib/engine/layout'
import { EXAMPLES } from '@/lib/shader/examples'
import { clearLogs, copyAllLogs, copyLogLine, log, logContext, shownLogs } from './logs'
import { isMac, isTauri } from './platform'
import { baseName, loadTauriFiles } from '@/lib/documents/tauri-files'
import { contextProblem, DOCK_TABS, resetLayout, showTab, workspace, type Mode } from './workspace'

export interface Command {
  id: string
  title: string | (() => string)
  /** Where the command shows: the top-level menu, then any submenus. */
  menu: string[]
  /** Neighbours in one menu with different groups get a separator between them. */
  group?: string
  /** `Mod+Shift+Enter`: Mod is Cmd on macOS and Ctrl elsewhere; the key is a character, a digit or a `KeyboardEvent.key` name. */
  accelerator?: string
  aliases?: string[]
  /** The modes the command exists in; every mode when absent. */
  modes?: Mode[]
  when?: () => boolean
  enabled?: () => boolean
  checked?: () => boolean
  /** A listener of the page owns the key: menus and the shortcut list show it, the dispatcher never fires it. */
  page?: boolean
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

export interface Accelerator {
  mod: boolean
  shift: boolean
  alt: boolean
  key: string
}

const registered = shallowReactive<Array<Command | CommandList>>([])
const handlers = shallowReactive(new Map<string, () => unknown>())

export const commands = computed(() => registered.flatMap((entry) => ('list' in entry ? entry.list() : entry)))

export const palette = reactive({ open: false, view: 'commands' as 'commands' | 'shortcuts' })

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

export const getCommand = (id: string) => commands.value.find((command) => command.id === id)
export const commandTitle = (command: Command) => (typeof command.title === 'function' ? command.title() : command.title)
export const isVisible = (command: Command) => (!command.modes || command.modes.includes(workspace.mode)) && (command.when?.() ?? true)
export const isEnabled = (command: Command) => (handlers.has(command.id) || !!command.run) && (command.enabled?.() ?? true)
export const isChecked = (command: Command) => command.checked?.() ?? false

/** Runs a command the way every surface does. False when it is hidden, disabled or unknown. */
export function runCommand(id: string): boolean {
  const command = getCommand(id)
  if (!command || !isVisible(command) || !isEnabled(command)) return false
  void (handlers.get(id) ?? command.run!)()
  return true
}

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

export { isMac }

const nativeMenuInstalled = ref(false)

/** The desktop shell calls this once it has built the operating system's menu from `menuTree()`. */
export const markNativeMenuInstalled = (installed = true) => { nativeMenuInstalled.value = installed }

/** True when the operating system shows the menus, so the window must not draw its own. */
export const hasNativeMenu = () => nativeMenuInstalled.value

/** The accelerator a native menu item binds. It takes the key before the page sees it, so keys a page listener owns and keys without Cmd/Ctrl, which text fields need, stay with the page. */
export const nativeAccelerator = (command: Command) =>
  (!command.page && !command.contextOnly && command.accelerator && parseAccelerator(command.accelerator).mod ? command.accelerator : undefined)

export function parseAccelerator(text: string): Accelerator {
  const parts = text.split('+')
  const key = parts.pop()!.toLowerCase()
  return { mod: parts.includes('Mod'), shift: parts.includes('Shift'), alt: parts.includes('Alt'), key }
}

/** `⌥⇧⌘K` on macOS, `Ctrl+Alt+Shift+K` elsewhere. */
export function formatAccelerator(text: string, mac = isMac()): string {
  const { mod, shift, alt, key } = parseAccelerator(text)
  const name = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1)
  if (mac) return `${alt ? '⌥' : ''}${shift ? '⇧' : ''}${mod ? '⌘' : ''}${({ enter: '↩', backspace: '⌫', delete: '⌦', home: '↖' } as Record<string, string>)[key] ?? name}`
  return [...(mod ? ['Ctrl'] : []), ...(alt ? ['Alt'] : []), ...(shift ? ['Shift'] : []), name].join('+')
}

/** The accelerator as the key names `UKbd` and the `kbds` props of Nuxt UI take. */
export function acceleratorKbds(text: string): string[] {
  const { mod, shift, alt, key } = parseAccelerator(text)
  return [...(mod ? ['meta'] : []), ...(alt ? ['alt'] : []), ...(shift ? ['shift'] : []), key]
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>

function eventKey(e: KeyLike): string {
  // Shift turns a digit into a symbol and Option on macOS does the same to a letter, so the physical key stands in for both
  const digit = /^Digit(\d)$/.exec(e.code)
  if (digit) return digit[1]
  const letter = e.altKey ? /^Key([A-Z])$/.exec(e.code) : null
  if (letter) return letter[1].toLowerCase()
  return e.key === ' ' ? 'space' : e.key.toLowerCase()
}

export function matchesAccelerator(e: KeyLike, accelerator: Accelerator, mac = isMac()): boolean {
  const [mod, other] = mac ? [e.metaKey, e.ctrlKey] : [e.ctrlKey, e.metaKey]
  return !other && mod === accelerator.mod && e.shiftKey === accelerator.shift && e.altKey === accelerator.alt && eventKey(e) === accelerator.key
}

/**
 * The one place accelerators fire from. It leaves alone what somebody handled already (CodeMirror, a page listener),
 * keys without Cmd/Ctrl while the user types, AltGr characters, and everything while a dialog or the node menu is up.
 */
export function dispatchKey(e: KeyboardEvent, mac = isMac()): boolean {
  if (e.defaultPrevented || e.repeat || e.getModifierState?.('AltGraph')) return false
  for (const command of commands.value) {
    if (command.page || !isVisible(command)) continue
    const hit = [command.accelerator, ...(command.aliases ?? [])].find((text) => text && matchesAccelerator(e, parseAccelerator(text), mac))
    if (!hit) continue
    // the native item runs the command; should the key reach the page as well, it must not run twice
    if (hasNativeMenu() && hit === nativeAccelerator(command)) return false
    if (!parseAccelerator(hit).mod && (e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable="true"], .cm-editor')) return false
    if (document.querySelector('[role="dialog"]')) return false
    // a disabled command still owns its key: Cmd+S must not fall through to the browser's Save Page
    e.preventDefault()
    runCommand(command.id)
    return true
  }
  return false
}

export function installKeyDispatcher(): () => void {
  const onKeydown = (e: KeyboardEvent) => void dispatchKey(e)
  window.addEventListener('keydown', onKeydown)
  return () => window.removeEventListener('keydown', onKeydown)
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    // WebKit (the desktop app's webview) never fires change on an input that is not in the document
    input.hidden = true
    document.body.append(input)
    const settle = (file: File | null) => {
      input.remove()
      resolve(file)
    }
    input.onchange = () => settle(input.files?.[0] ?? null)
    input.oncancel = () => settle(null)
    input.click()
  })
}

let colorMode: ReturnType<typeof useColorMode> | undefined
const theme = () => (colorMode ??= useColorMode()).store

const themeCommand = (value: 'light' | 'dark' | 'auto', title: string, accelerator: string): Command => ({
  id: `view.theme.${value}`,
  title,
  menu: ['View', 'Theme'],
  group: 'appearance',
  accelerator,
  checked: () => theme().value === value,
  run: () => { theme().value = value },
})

const audioSource = () => useEngine().audio.state.settings.source

async function chooseSong() {
  const file = await pickFile('audio/*')
  if (!file) return
  const engine = useEngine()
  if (!(await engine.useSong({ blob: file, name: file.name }))) return
  await engine.audio.configure({ source: 'file' })
  log(`Using your song: ${file.name}`)
}

async function chooseImage() {
  const file = await pickFile('image/*')
  if (!file) return
  await useEngine().useImage({ blob: file, name: file.name })
  log(`Using your image: ${file.name}`)
}

// a song or an image stays with the webview's file input: a file read through the fs plugin has no media type, which a blob URL needs to play
async function pickConfigFile(): Promise<File | null> {
  if (!isTauri()) return pickFile('application/json')
  const files = await loadTauriFiles()
  const path = await files.pickOpen({ name: 'WLEDtoy config', extensions: ['json'] })
  return path === null ? null : new File([await files.readTextFile(path)], baseName(path))
}

async function chooseConfig() {
  const file = await pickConfigFile()
  if (!file) return
  try {
    const picked = await importConfig(file)
    log(`Imported ${file.name} (${Object.keys(picked).join(', ') || 'nothing usable'})`)
  } catch (e) {
    log(`Import failed: ${(e as Error).message}`, 'error')
  }
}

registerCommands([
  { id: 'file.new', title: () => (workspace.mode === 'shader' ? 'New Shader' : 'New Graph'), menu: ['File'], group: 'document', accelerator: 'Mod+N' },
  { id: 'file.open', title: 'Open...', menu: ['File'], group: 'document', accelerator: 'Mod+O' },
  { id: 'file.openRecent', title: 'Open Recent', menu: ['File'], group: 'document', accelerator: 'Mod+Shift+O' },
  { id: 'file.save', title: 'Save', menu: ['File'], group: 'document', accelerator: 'Mod+S' },
  { id: 'file.saveAs', title: 'Save As...', menu: ['File'], group: 'document', accelerator: 'Mod+Shift+S' },
  { id: 'file.revert', title: 'Revert', menu: ['File'], group: 'document', accelerator: 'Mod+Alt+R' },
  // imported on use: the bundler pulls in the graph compiler, which nothing else in the registry needs
  { id: 'file.exportGlsl', title: 'Standalone GLSL...', menu: ['File', 'Export'], group: 'document', accelerator: 'Mod+Alt+E', modes: ['shader', 'graph'], run: async () => (await import('@/lib/shader/shader-export')).exportStandaloneGlsl() },
  {
    id: 'shader.examples',
    list: () => EXAMPLES.map((example) => ({
      id: `shader.example.${example.name}`,
      title: example.name,
      menu: ['File', 'Load Example'],
      group: 'document',
      modes: ['shader'],
      // the shader page compiles whatever lands in config.code
      run: () => {
        config.code = example.code
        log(`Loaded example: ${example.name} (Cmd+Z in the editor restores your previous shader)`)
      },
    })),
  },

  { id: 'audio.fromFile', title: 'From File...', menu: ['File', 'Set Audio'], group: 'media', accelerator: 'Mod+Alt+U', checked: () => audioSource() === 'file' && useEngine().audio.state.fileName !== 'Built-in track', run: chooseSong },
  {
    id: 'audio.builtIn',
    title: 'Use Built-in Track',
    menu: ['File', 'Set Audio'],
    group: 'media',
    accelerator: 'Mod+Alt+Shift+U',
    checked: () => audioSource() === 'file' && useEngine().audio.state.fileName === 'Built-in track',
    run: async () => {
      await useEngine().useSong(null)
      await useEngine().audio.configure({ source: 'file' })
    },
  },
  { id: 'audio.microphone', title: 'Microphone', menu: ['File', 'Set Audio'], group: 'capture', accelerator: 'Mod+Alt+Y', checked: () => audioSource() === 'device', run: () => useEngine().audio.configure({ source: 'device' }) },
  {
    id: 'audio.system',
    title: () => (systemAudioBlocked() ? 'System Audio (not available in the desktop app)' : 'System Audio'),
    menu: ['File', 'Set Audio'],
    group: 'capture',
    accelerator: 'Mod+Alt+Shift+Y',
    enabled: () => !systemAudioBlocked(),
    checked: () => audioSource() === 'loopback',
    run: () => useEngine().audio.configure({ source: 'loopback' }),
  },
  { id: 'image.fromFile', title: 'From File...', menu: ['File', 'Set Image'], group: 'media', accelerator: 'Mod+Alt+P', checked: () => useEngine().imageName.value !== 'Built-in image', run: chooseImage },
  { id: 'image.builtIn', title: 'Use Built-in Image', menu: ['File', 'Set Image'], group: 'media', accelerator: 'Mod+Alt+Shift+P', checked: () => useEngine().imageName.value === 'Built-in image', run: () => useEngine().useImage(null) },

  { id: 'config.import', title: 'Import Config...', menu: ['File'], group: 'config', accelerator: 'Mod+Alt+O', run: chooseConfig },
  { id: 'config.export', title: 'Export Config...', menu: ['File'], group: 'config', accelerator: 'Mod+Alt+S', run: async () => { if (await exportConfig()) log('Config exported') } },
  { id: 'app.preferences', title: 'Preferences...', menu: ['File'], group: 'preferences', accelerator: 'Mod+,' },
  {
    id: 'app.quit',
    title: 'Quit WLEDtoy',
    menu: ['File'],
    group: 'quit',
    accelerator: 'Mod+Q',
    when: isTauri,
    // closing the window, not ending the process: the close request is where unsaved work gets asked about
    run: async () => (await import('@tauri-apps/api/window')).getCurrentWindow().close(),
  },

  { id: 'mode.shader', title: 'Shader', menu: ['View'], group: 'mode', accelerator: 'Mod+1', checked: () => workspace.mode === 'shader' },
  { id: 'mode.graph', title: 'Graph', menu: ['View'], group: 'mode', accelerator: 'Mod+2', checked: () => workspace.mode === 'graph' },
  { id: 'mode.reference', title: 'Reference', menu: ['View'], group: 'mode', accelerator: 'Mod+3', checked: () => workspace.mode === 'reference' },

  { id: 'view.toggleDock', title: 'Side Panel', menu: ['View'], group: 'layout', accelerator: 'Mod+B', checked: () => workspace.dockVisible, run: () => { workspace.dockVisible = !workspace.dockVisible } },
  { id: 'view.toggleBottom', title: 'Bottom Panel', menu: ['View'], group: 'layout', accelerator: 'Mod+J', checked: () => workspace.bottomVisible, run: () => { workspace.bottomVisible = !workspace.bottomVisible } },
  // a matrix or a ring has no row to show; the preview pane draws those
  { id: 'view.ledStrip', title: 'LED Strip', menu: ['View'], group: 'layout', accelerator: 'Mod+Alt+L', checked: () => workspace.stripVisible, enabled: () => isStripLayout(config.layout), run: () => { workspace.stripVisible = !workspace.stripVisible } },
  { id: 'view.hideDock', title: 'Hide Side Panel', menu: ['View'], group: 'layout', accelerator: 'Mod+Alt+Shift+B', contextOnly: true, run: () => { workspace.dockVisible = false } },
  { id: 'view.hideBottom', title: 'Hide Bottom Panel', menu: ['View'], group: 'layout', accelerator: 'Mod+Alt+Shift+J', contextOnly: true, run: () => { workspace.bottomVisible = false } },
  ...DOCK_TABS.map((tab): Command => ({
    id: `view.panel.${tab.id}`,
    title: tab.label,
    menu: ['View', 'Show Panel'],
    group: 'layout',
    accelerator: `Mod+Shift+${{ parameters: 'D', output: 'T', inputs: 'I', problems: 'M', log: 'Y', glsl: 'E', performance: 'H' }[tab.id]}`,
    modes: [...tab.modes],
    run: () => showTab(tab.id),
  })),
  { id: 'view.resetLayout', title: 'Reset Layout', menu: ['View'], group: 'layout', accelerator: 'Mod+Alt+0', run: resetLayout },

  themeCommand('light', 'Light', 'Mod+Alt+Shift+L'),
  themeCommand('dark', 'Dark', 'Mod+Alt+Shift+D'),
  themeCommand('auto', 'System', 'Mod+Alt+Shift+S'),
  { id: 'view.commandPalette', title: 'Command Palette...', menu: ['View'], group: 'appearance', accelerator: 'Mod+K', aliases: ['Mod+Shift+P'], run: () => { palette.view = 'commands'; palette.open = true } },

  { id: 'playback.toggleAudio', title: () => (useEngine().audio.state.playing ? 'Pause Audio' : 'Play Audio'), menu: ['View'], group: 'playback', accelerator: 'Mod+Shift+Space', run: () => useEngine().toggleAudio() },
  { id: 'playback.resetTime', title: 'Reset Time', menu: ['View'], group: 'playback', accelerator: 'Mod+Shift+0', run: () => useEngine().resetTime() },
  { id: 'output.toggleStream', title: () => (useEngine().streaming.value ? 'Stop Streaming' : 'Start Streaming'), menu: ['View'], group: 'playback', accelerator: 'Mod+Shift+Enter', run: () => useEngine().toggleStream() },
  {
    id: 'output.devices',
    list: () => devices.value.map((device, index) => ({
      id: `output.device.${device.id}`,
      title: device.name,
      menu: ['View', 'Switch Device'],
      group: 'playback',
      accelerator: index < 9 ? `Mod+Alt+${index + 1}` : undefined,
      checked: () => activeDeviceId.value === device.id,
      run: () => setActiveDevice(device.id),
    })),
  },

  { id: 'shader.compile', title: 'Compile', menu: ['View'], group: 'editor', accelerator: 'Mod+Enter', modes: ['shader'], page: true },
  { id: 'shader.addFunction', title: 'Add Function...', menu: ['View'], group: 'editor', accelerator: 'Mod+Shift+A', modes: ['shader'], page: true },
  { id: 'shader.undo', title: 'Undo', menu: ['View'], group: 'editor', accelerator: 'Mod+Z', modes: ['shader'], page: true },
  { id: 'shader.redo', title: 'Redo', menu: ['View'], group: 'editor', accelerator: 'Mod+Shift+Z', modes: ['shader'], page: true },
  { id: 'shader.selectAll', title: 'Select All', menu: ['View'], group: 'editor', accelerator: 'Mod+A', modes: ['shader'], page: true },
  { id: 'graph.addNode', title: 'Add Node...', menu: ['View'], group: 'editor', accelerator: 'Shift+A', modes: ['graph'], page: true },
  { id: 'graph.searchNodes', title: 'Search Nodes', menu: ['View'], group: 'editor', accelerator: 'Space', modes: ['graph'], page: true },
  { id: 'graph.fitView', title: 'Fit View', menu: ['View'], group: 'editor', accelerator: 'Home', modes: ['graph'] },
  { id: 'graph.sendToShader', title: 'Send to Shader Mode', menu: ['View'], group: 'editor', accelerator: 'Mod+Alt+Enter', modes: ['graph'] },
  { id: 'graph.copyGlsl', title: 'Copy Generated GLSL', menu: ['View'], group: 'editor', accelerator: 'Mod+Alt+Shift+E', modes: ['graph'] },
  { id: 'graph.copy', title: 'Copy Nodes', menu: ['View'], group: 'clipboard', accelerator: 'Mod+C', modes: ['graph'], page: true },
  { id: 'graph.cut', title: 'Cut Nodes', menu: ['View'], group: 'clipboard', accelerator: 'Mod+X', modes: ['graph'], page: true },
  { id: 'graph.paste', title: 'Paste Nodes', menu: ['View'], group: 'clipboard', accelerator: 'Mod+V', modes: ['graph'], page: true },
  { id: 'graph.undo', title: 'Undo', menu: ['View'], group: 'clipboard', accelerator: 'Mod+Z', modes: ['graph'], page: true },
  { id: 'graph.redo', title: 'Redo', menu: ['View'], group: 'clipboard', accelerator: 'Mod+Shift+Z', modes: ['graph'], page: true },
  { id: 'graph.selectAll', title: 'Select All Nodes', menu: ['View'], group: 'clipboard', accelerator: 'Mod+A', modes: ['graph'], page: true },
  { id: 'graph.deselectAll', title: 'Deselect All', menu: ['View'], group: 'clipboard', accelerator: 'Alt+A', aliases: ['Escape'], modes: ['graph'], page: true },
  { id: 'graph.delete', title: 'Delete Nodes', menu: ['View'], group: 'clipboard', accelerator: 'X', aliases: ['Backspace', 'Delete'], modes: ['graph'], page: true },

  { id: 'log.copyLine', title: 'Copy Line', menu: ['View'], group: 'log', accelerator: 'Mod+Alt+Shift+C', enabled: () => !!logContext.value, run: copyLogLine },
  { id: 'log.copyAll', title: 'Copy All', menu: ['View'], group: 'log', accelerator: 'Mod+Alt+Shift+X', enabled: () => shownLogs.value.length > 0, run: copyAllLogs },
  { id: 'log.clear', title: 'Clear', menu: ['View'], group: 'log', accelerator: 'Mod+Alt+Shift+K', run: clearLogs },

  { id: 'problems.copyMessage', title: 'Copy Message', menu: ['View'], group: 'problems', accelerator: 'Mod+Alt+Shift+M', modes: ['shader', 'graph'], enabled: () => !!contextProblem.value, run: () => contextProblem.value && copyText(contextProblem.value.message) },
  { id: 'problems.goto', title: () => (contextProblem.value?.nodeId ? 'Reveal Node' : 'Go to Line'), menu: ['View'], group: 'problems', accelerator: 'Mod+Alt+Shift+G', modes: ['shader', 'graph'], enabled: () => !!contextProblem.value },

  { id: 'reference.focusSearch', title: 'Focus Search', menu: ['View'], group: 'reference', accelerator: '/', aliases: ['Mod+F'], modes: ['reference'] },
  { id: 'reference.copyEntry', title: 'Copy Signature', menu: ['View'], group: 'reference', accelerator: 'Mod+C', modes: ['reference'], page: true },

  { id: 'help.reference', title: 'Shader Reference', menu: ['Help'], accelerator: 'F1' },
  { id: 'help.shortcuts', title: 'Keyboard Shortcuts', menu: ['Help'], accelerator: 'Mod+Alt+K', run: () => { palette.view = 'shortcuts'; palette.open = true } },
  { id: 'help.launchScreen', title: 'Launch Screen', menu: ['Help'], accelerator: 'Mod+Alt+Shift+W' },
  { id: 'help.about', title: 'About WLEDtoy', menu: ['Help'], accelerator: 'Shift+F1' },
])
