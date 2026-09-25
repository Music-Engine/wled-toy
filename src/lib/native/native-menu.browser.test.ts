import { nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commands, hasNativeMenu, isVisible, markNativeMenuInstalled, registerCommands, registerHandlers } from '@/lib/app/commands'
import { useEngine } from '@/lib/engine/engine'
// replaces the Open Recent placeholder with the list, as the app does
import '@/lib/graph/model/document'
import { createNativeMenu, installNativeMenu, type MenuApi } from './native-menu'
import { resetLayout, workspace } from '@/lib/app/workspace'

const setPlatform = (value: string) => Object.defineProperty(navigator, 'platform', { value, configurable: true })
const setTauri = (on: boolean) => {
  if (on) (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
  else delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
}

const cleanups: Array<() => void> = []

// app.quit exists under Tauri only, and the menu is installed on macOS only
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

interface FakeNode {
  kind: 'Menu' | 'Submenu' | 'MenuItem' | 'CheckMenuItem' | 'Predefined'
  options: { id?: string; text?: string; enabled?: boolean; checked?: boolean; accelerator?: string; item?: string; items?: FakeNode[]; action?: () => void }
  closed: boolean
}

/** Stands in for `@tauri-apps/api/menu`: remembers what was built, which menu is the app menu, and every call that changed an item. */
function fakeMenuApi() {
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

describe('the menu model', () => {
  it('puts the app menu first, Edit after File and Window before Help, and hands Window and Help to the system', async () => {
    workspace.mode = 'graph'
    const fake = fakeMenuApi()
    await createNativeMenu(fake.api).sync()

    expect(fake.outline(fake.state.appMenu!)).toEqual(['WLEDtoy >', 'File >', 'Edit >', 'View >', 'Window >', 'Help >'])
    expect(fake.outline(fake.submenu('WLEDtoy'))).toEqual([
      'About WLEDtoy', '<Separator>', 'Preferences... [CmdOrCtrl+,]', '<Separator>', '<Services>', '<Separator>',
      '<Hide>', '<HideOthers>', '<ShowAll>', '<Separator>', 'Quit WLEDtoy [CmdOrCtrl+Q]',
    ])
    expect(fake.outline(fake.submenu('Window'))).toEqual(['<Minimize>', '<Maximize>', '<Separator>', '<CloseWindow>'])
    expect(fake.state.windowsMenu).toBe(fake.submenu('Window'))
    expect(fake.state.helpMenu).toBe(fake.submenu('Help'))
  })

  it('maps the registry tree: submenus, separators between groups, check items, disabled items', async () => {
    workspace.mode = 'graph'
    const fake = fakeMenuApi()
    await createNativeMenu(fake.api).sync()

    expect(fake.outline(fake.submenu('File'))).toEqual([
      'New Graph [CmdOrCtrl+N]', 'Open... [CmdOrCtrl+O]', 'Open Recent >', 'Save [CmdOrCtrl+S]', 'Save As... [CmdOrCtrl+Shift+S]', 'Revert [CmdOrCtrl+Alt+R]', 'Export >',
      '<Separator>', 'Set Audio >', 'Set Image >',
      '<Separator>', 'Import Config... [CmdOrCtrl+Alt+O]', 'Export Config... [CmdOrCtrl+Alt+S]',
    ])
    expect(fake.outline(fake.submenu('File', 'Open Recent'))).toEqual(['No Recent Files [CmdOrCtrl+Shift+O]'])
    expect(fake.find('file.recent.none')!.options.enabled).toBe(false)
    expect(fake.outline(fake.submenu('File', 'Set Audio'))).toEqual([
      'From File... [CmdOrCtrl+Alt+U]', 'Use Built-in Track [CmdOrCtrl+Alt+Shift+U]', '<Separator>', 'Microphone [CmdOrCtrl+Alt+Y]', 'System Audio (not available in the desktop app) [CmdOrCtrl+Alt+Shift+Y]',
    ])
    // WKWebView delivers no audio through getDisplayMedia
    expect(fake.find('audio.system')!.options.enabled).toBe(false)
    expect(fake.find('mode.graph')).toMatchObject({ kind: 'CheckMenuItem', options: { checked: true } })
    expect(fake.find('mode.shader')).toMatchObject({ kind: 'CheckMenuItem', options: { checked: false } })
    // nothing binds file.save until the graph page mounts
    expect(fake.find('file.save')).toMatchObject({ kind: 'MenuItem', options: { enabled: false } })
    expect(fake.outline(fake.submenu('Help'))).toEqual(['Shader Reference', 'Keyboard Shortcuts [CmdOrCtrl+Alt+K]', 'Launch Screen [CmdOrCtrl+Alt+Shift+W]'])
  })

  it('has the predefined Edit items text fields need, and a Select All of its own on Cmd+A in every mode', async () => {
    for (const mode of ['shader', 'graph', 'reference'] as const) {
      workspace.mode = mode
      const fake = fakeMenuApi()
      await createNativeMenu(fake.api).sync()
      expect(fake.outline(fake.submenu('Edit'))).toEqual(['Undo [CmdOrCtrl+Z]', 'Redo [CmdOrCtrl+Shift+Z]', '<Separator>', '<Cut>', '<Copy>', '<Paste>', 'Select All [CmdOrCtrl+A]'])
      // the predefined one would take the key and tell the page nothing
      expect(fake.built('Predefined').map((node) => node.options.item)).not.toContain('SelectAll')
    }
  })

  it('Select All selects the text of the focused field or editable, else the nodes of a graph, else nothing', async () => {
    const selectNodes = vi.fn()
    cleanups.push(registerHandlers({ 'graph.selectAll': selectNodes }))
    const input = Object.assign(document.createElement('input'), { value: 'hello' })
    const area = Object.assign(document.createElement('textarea'), { value: 'two\nlines' })
    const editable = Object.assign(document.createElement('div'), { contentEditable: 'true', textContent: 'editable text' })
    const editor = document.createElement('div')
    editor.className = 'cm-editor'
    const content = Object.assign(document.createElement('div'), { contentEditable: 'true', textContent: 'void main' })
    editor.append(content)
    document.body.append(input, area, editable, editor)
    cleanups.push(() => [input, area, editable, editor].forEach((el) => el.remove()))

    workspace.mode = 'graph'
    const fake = fakeMenuApi()
    await createNativeMenu(fake.api).sync()
    const selectAll = () => fake.find('edit.selectAll')!.options.action!()

    input.focus()
    input.setSelectionRange(0, 0)
    selectAll()
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5])
    area.focus()
    area.setSelectionRange(0, 0)
    selectAll()
    expect([area.selectionStart, area.selectionEnd]).toEqual([0, 9])
    for (const el of [editable, content]) {
      el.focus()
      getSelection()!.removeAllRanges()
      selectAll()
      expect(getSelection()!.toString()).toBe(el.textContent)
    }
    expect(selectNodes).not.toHaveBeenCalled()

    content.blur()
    getSelection()!.removeAllRanges()
    selectAll()
    expect(selectNodes).toHaveBeenCalledOnce()

    workspace.mode = 'shader'
    selectAll()
    expect(selectNodes).toHaveBeenCalledOnce()
    expect(getSelection()!.toString()).toBe('')
  })

  it('Undo and Redo go to the code editor or the text field that has focus, otherwise to the graph, and nowhere in other modes', async () => {
    const graph = { undo: vi.fn(), redo: vi.fn() }
    const shader = { undo: vi.fn(), redo: vi.fn() }
    cleanups.push(registerHandlers({ 'graph.undo': graph.undo, 'graph.redo': graph.redo, 'shader.undo': shader.undo, 'shader.redo': shader.redo }))
    const editor = Object.assign(document.createElement('div'), { className: 'cm-editor' })
    const content = Object.assign(document.createElement('div'), { contentEditable: 'true', textContent: 'void main' })
    editor.append(content)
    const input = Object.assign(document.createElement('input'), { value: 'typed' })
    document.body.append(editor, input)
    cleanups.push(() => [editor, input].forEach((el) => el.remove()))

    workspace.mode = 'graph'
    const fake = fakeMenuApi()
    await createNativeMenu(fake.api).sync()
    const run = (id: string) => fake.find(id)!.options.action!()

    run('edit.undo')
    run('edit.redo')
    expect([graph.undo.mock.calls.length, graph.redo.mock.calls.length]).toEqual([1, 1])

    // the code editor only exists in shader mode, which is also the only mode its commands show in
    workspace.mode = 'shader'
    content.focus()
    run('edit.undo')
    run('edit.redo')
    expect([shader.undo.mock.calls.length, shader.redo.mock.calls.length]).toEqual([1, 1])

    workspace.mode = 'graph'
    input.focus()
    run('edit.undo')
    expect([graph.undo.mock.calls.length, shader.undo.mock.calls.length]).toEqual([1, 1])

    input.blur()
    workspace.mode = 'reference'
    run('edit.undo')
    expect(graph.undo).toHaveBeenCalledOnce()
  })

  it('shows no hide item: the dock tab context menu keeps those', async () => {
    const fake = fakeMenuApi()
    await createNativeMenu(fake.api).sync()
    expect(fake.find('view.hideDock')).toBeUndefined()
    expect(fake.find('view.hideBottom')).toBeUndefined()
    expect(fake.find('view.toggleDock')).toMatchObject({ kind: 'CheckMenuItem', options: { text: 'Side Panel', accelerator: 'CmdOrCtrl+B' } })
    expect(fake.find('view.toggleBottom')).toMatchObject({ kind: 'CheckMenuItem', options: { text: 'Bottom Panel', accelerator: 'CmdOrCtrl+J' } })
  })

  it('gives a native accelerator to exactly the commands the registry dispatches on a Cmd/Ctrl key', async () => {
    for (const mode of ['graph', 'shader', 'reference'] as const) {
      workspace.mode = mode
      const fake = fakeMenuApi()
      await createNativeMenu(fake.api).sync()
      for (const command of commands.value.filter((c) => isVisible(c) && !c.contextOnly)) {
        const bound = !command.textKey && !!command.accelerator?.startsWith('Mod+')
        expect([command.id, !!fake.find(command.id)!.options.accelerator]).toEqual([command.id, bound])
      }
    }
  })

  it('leaves text keys and keys without Cmd/Ctrl to the page', async () => {
    workspace.mode = 'graph'
    const graph = fakeMenuApi()
    await createNativeMenu(graph.api).sync()
    for (const id of ['graph.addNode', 'graph.selectAll', 'graph.deselectAll', 'graph.searchNodes', 'graph.copy', 'graph.cut', 'graph.paste', 'graph.delete', 'graph.fitView', 'help.reference', 'help.about']) {
      expect([id, graph.find(id)!.options.accelerator]).toEqual([id, undefined])
    }
    workspace.mode = 'shader'
    const shader = fakeMenuApi()
    await createNativeMenu(shader.api).sync()
    for (const id of ['shader.compile', 'shader.addFunction', 'shader.selectAll']) expect([id, shader.find(id)!.options.accelerator]).toEqual([id, undefined])
    expect(shader.find('output.toggleStream')!.options.accelerator).toBe('CmdOrCtrl+Shift+Enter')
  })
})

describe('keeping the menu current', () => {
  it('patches text, enabled and checked in place, and rebuilds only when the items themselves change', async () => {
    const live = reactive({ title: 'Blink', enabled: true })
    cleanups.push(registerCommands([{ id: 'test.live', title: () => live.title, menu: ['View'], enabled: () => live.enabled, run: () => undefined }]))
    const fake = fakeMenuApi()
    const menu = createNativeMenu(fake.api)
    await menu.sync()
    const first = fake.state.appMenu

    live.title = 'Blink Faster'
    live.enabled = false
    workspace.dockVisible = !workspace.dockVisible
    await menu.sync()
    // in menu order
    expect(fake.calls).toEqual([`setChecked view.toggleDock ${workspace.dockVisible}`, 'setText test.live Blink Faster', 'setEnabled test.live false'])
    expect(fake.built('Menu')).toHaveLength(1)

    await menu.sync()
    expect(fake.calls).toHaveLength(3)

    // another mode has other items
    const builtFirst = fake.created.length
    workspace.mode = 'graph'
    await menu.sync()
    expect(fake.built('Menu')).toHaveLength(2)
    expect(fake.state.appMenu).not.toBe(first)
    expect(fake.calls).toHaveLength(3)
    // what the first menu was made of is released, the menu in use is not
    expect(fake.created.map((node) => node.closed)).toEqual(fake.created.map((_, i) => i < builtFirst))
  })

  it('a click runs the command once', async () => {
    const run = vi.fn()
    cleanups.push(registerCommands([{ id: 'test.once', title: 'Once', menu: ['View'], accelerator: 'Mod+Alt+Shift+9', run }]))
    const fake = fakeMenuApi()
    await createNativeMenu(fake.api).sync()
    fake.click('test.once')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('a click on a disabled or hidden command runs nothing', async () => {
    const run = vi.fn()
    const live = reactive({ enabled: true })
    cleanups.push(registerCommands([{ id: 'test.gated', title: 'Gated', menu: ['View'], enabled: () => live.enabled, run }]))
    const fake = fakeMenuApi()
    await createNativeMenu(fake.api).sync()
    // the registry decides, also when the system item has not caught up yet
    live.enabled = false
    fake.click('test.gated')
    expect(run).not.toHaveBeenCalled()
  })

  it('puts the check mark back where the command says after the system flipped it on a click', async () => {
    const picked = reactive({ value: 'a' })
    cleanups.push(registerCommands(['a', 'b'].map((value) => ({ id: `test.pick.${value}`, title: value, menu: ['View'], checked: () => picked.value === value, run: () => { picked.value = value } }))))
    const fake = fakeMenuApi()
    const menu = createNativeMenu(fake.api)
    await menu.sync()

    // choosing what is chosen already changes no state, and still the system took the mark away
    fake.click('test.pick.a')
    expect(fake.find('test.pick.a')!.options.checked).toBe(false)
    await menu.sync()
    expect(fake.find('test.pick.a')!.options.checked).toBe(true)

    fake.click('test.pick.b')
    await menu.sync()
    expect([fake.find('test.pick.a')!.options.checked, fake.find('test.pick.b')!.options.checked]).toEqual([false, true])
  })
})

describe('installNativeMenu', () => {
  it('builds the menu on macOS under Tauri, reports it, and follows the registry after a pause', async () => {
    vi.useFakeTimers()
    const fake = fakeMenuApi()
    await installNativeMenu(async () => fake.api)
    expect(hasNativeMenu()).toBe(true)
    expect(fake.state.appMenu).not.toBeNull()

    workspace.bottomVisible = !workspace.bottomVisible
    await nextTick()
    await vi.advanceTimersByTimeAsync(40)
    expect(fake.calls).toEqual([])
    await vi.advanceTimersByTimeAsync(20)
    expect(fake.calls).toEqual([`setChecked view.toggleBottom ${workspace.bottomVisible}`])
  })

  it('leaves Windows, Linux and the browser with the menubar the window draws', async () => {
    for (const [tauri, platform] of [[true, 'Win32'], [true, 'Linux x86_64'], [false, 'MacIntel']] as const) {
      setTauri(tauri)
      setPlatform(platform)
      const loadApi = vi.fn(async () => fakeMenuApi().api)
      await installNativeMenu(loadApi)
      expect([platform, loadApi.mock.calls.length, hasNativeMenu()]).toEqual([platform, 0, false])
    }
  })
})
