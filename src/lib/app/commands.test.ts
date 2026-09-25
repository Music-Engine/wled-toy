import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuNode, Submenu } from './commands'

const stored = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => stored.set(key, value),
  removeItem: (key: string) => stored.delete(key),
})
// config.ts listens for storage events at import time, as its own tests stub too
vi.stubGlobal('window', { addEventListener: () => undefined })

// a fresh module instance starts from the app's own registrations
async function load() {
  vi.resetModules()
  return {
    ...(await import('./commands')),
    ...(await import('./workspace')),
    ...(await import('./logs')),
    ...(await import('./clipboard')),
  }
}

beforeEach(() => stored.clear())
afterEach(() => vi.restoreAllMocks())

const key = (init: Partial<Record<'key' | 'code', string> & Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>>) =>
  ({ key: '', code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init })

describe('accelerators', () => {
  it('parses modifiers in any order and lowercases the key', async () => {
    const { parseAccelerator } = await load()
    expect(parseAccelerator('Mod+Shift+Enter')).toEqual({ mod: true, ctrl: false, shift: true, alt: false, key: 'enter' })
    expect(parseAccelerator('Shift+Alt+Mod+K')).toEqual({ mod: true, ctrl: false, shift: true, alt: true, key: 'k' })
    expect(parseAccelerator('Home')).toEqual({ mod: false, ctrl: false, shift: false, alt: false, key: 'home' })
    expect(parseAccelerator('Mod+,')).toEqual({ mod: true, ctrl: false, shift: false, alt: false, key: ',' })
    expect(parseAccelerator('Ctrl+Space')).toEqual({ mod: false, ctrl: true, shift: false, alt: false, key: 'space' })
  })

  it('formats as glyphs on macOS and as Ctrl+ text elsewhere', async () => {
    const { formatAccelerator } = await load()
    expect(formatAccelerator('Mod+Shift+Enter', true)).toBe('⇧⌘↩')
    expect(formatAccelerator('Mod+Shift+Enter', false)).toBe('Ctrl+Shift+Enter')
    expect(formatAccelerator('Mod+Alt+Shift+L', true)).toBe('⌥⇧⌘L')
    expect(formatAccelerator('Mod+Alt+Shift+L', false)).toBe('Ctrl+Alt+Shift+L')
    expect(formatAccelerator('Mod+,', true)).toBe('⌘,')
    expect(formatAccelerator('Shift+F1', false)).toBe('Shift+F1')
    expect(formatAccelerator('Space', true)).toBe('Space')
    expect(formatAccelerator('Home', true)).toBe('↖')
    expect(formatAccelerator('Home', false)).toBe('Home')
    expect(formatAccelerator('Ctrl+H', true)).toBe('⌃H')
    expect(formatAccelerator('Ctrl+H', false)).toBe('Ctrl+H')
    expect(formatAccelerator('NumpadDecimal', true)).toBe('Numpad .')
  })

  it('names the keys the way Nuxt UI kbds take them', async () => {
    const { acceleratorKbds } = await load()
    expect(acceleratorKbds('Mod+Alt+Shift+P')).toEqual(['meta', 'alt', 'shift', 'p'])
    expect(acceleratorKbds('Home')).toEqual(['home'])
    expect(acceleratorKbds('Ctrl+Space')).toEqual(['ctrl', 'space'])
    expect(acceleratorKbds('NumpadDecimal')).toEqual(['Numpad .'])
  })

  it('Ctrl is Ctrl on every platform, so on macOS it is not Cmd, and elsewhere it is the same key as Mod', async () => {
    const { matchesAccelerator, parseAccelerator } = await load()
    const hide = parseAccelerator('Ctrl+H')
    expect(matchesAccelerator(key({ key: 'h', ctrlKey: true }), hide, true)).toBe(true)
    expect(matchesAccelerator(key({ key: 'h', metaKey: true }), hide, true)).toBe(false)
    expect(matchesAccelerator(key({ key: 'h', ctrlKey: true }), hide, false)).toBe(true)
    expect(matchesAccelerator(key({ key: 'h', ctrlKey: true }), parseAccelerator('Mod+H'), true)).toBe(false)
  })

  it('the numpad period is its own key, also when NumLock off makes it Delete, and the numpad digits stay digits', async () => {
    const { matchesAccelerator, parseAccelerator } = await load()
    for (const sent of ['.', 'Delete']) {
      expect(matchesAccelerator(key({ key: sent, code: 'NumpadDecimal' }), parseAccelerator('NumpadDecimal'), true)).toBe(true)
      expect(matchesAccelerator(key({ key: sent, code: 'NumpadDecimal' }), parseAccelerator('Delete'), true)).toBe(false)
    }
    expect(matchesAccelerator(key({ key: 'Delete', code: 'Delete' }), parseAccelerator('Delete'), true)).toBe(true)
    expect(matchesAccelerator(key({ key: '1', code: 'Numpad1', metaKey: true }), parseAccelerator('Mod+1'), true)).toBe(true)
  })

  it('Mod is Cmd on macOS and Ctrl elsewhere, and the other one never stands in', async () => {
    const { matchesAccelerator, parseAccelerator } = await load()
    const toggle = parseAccelerator('Mod+B')
    expect(matchesAccelerator(key({ key: 'b', metaKey: true }), toggle, true)).toBe(true)
    expect(matchesAccelerator(key({ key: 'b', ctrlKey: true }), toggle, true)).toBe(false)
    expect(matchesAccelerator(key({ key: 'b', ctrlKey: true }), toggle, false)).toBe(true)
    expect(matchesAccelerator(key({ key: 'b', metaKey: true }), toggle, false)).toBe(false)
    expect(matchesAccelerator(key({ key: 'b', metaKey: true, ctrlKey: true }), toggle, true)).toBe(false)
  })

  it('an extra or a missing modifier is a different accelerator', async () => {
    const { matchesAccelerator, parseAccelerator } = await load()
    expect(matchesAccelerator(key({ key: 'B', metaKey: true, shiftKey: true }), parseAccelerator('Mod+B'), true)).toBe(false)
    expect(matchesAccelerator(key({ key: 'b' }), parseAccelerator('Mod+B'), true)).toBe(false)
    expect(matchesAccelerator(key({ key: 'Home', metaKey: true }), parseAccelerator('Home'), true)).toBe(false)
    expect(matchesAccelerator(key({ key: 'Home', ctrlKey: true }), parseAccelerator('Home'), true)).toBe(false)
    expect(matchesAccelerator(key({ key: 'Home' }), parseAccelerator('Home'), true)).toBe(true)
  })

  it('reads the physical key where Shift or Option changes the character', async () => {
    const { matchesAccelerator, parseAccelerator } = await load()
    expect(matchesAccelerator(key({ key: ')', code: 'Digit0', metaKey: true, shiftKey: true }), parseAccelerator('Mod+Shift+0'), true)).toBe(true)
    expect(matchesAccelerator(key({ key: '˚', code: 'KeyK', metaKey: true, altKey: true }), parseAccelerator('Mod+Alt+K'), true)).toBe(true)
    expect(matchesAccelerator(key({ key: ' ', code: 'Space', metaKey: true, shiftKey: true }), parseAccelerator('Mod+Shift+Space'), true)).toBe(true)
    // without Option the character decides, so a remapped layout keeps its letters
    expect(matchesAccelerator(key({ key: 'j', code: 'KeyC', metaKey: true }), parseAccelerator('Mod+J'), true)).toBe(true)
  })

  it('a bare letter does not answer its Shift chord, so Shift+X stays free for a command of its own', async () => {
    const { matchesAccelerator, parseAccelerator } = await load()
    expect(matchesAccelerator(key({ key: 'x', code: 'KeyX' }), parseAccelerator('X'), true)).toBe(true)
    expect(matchesAccelerator(key({ key: 'X', code: 'KeyX', shiftKey: true }), parseAccelerator('X'), true)).toBe(false)
  })
})

describe('registry', () => {
  it('a command outside its modes is hidden and does not run', async () => {
    const { registerCommands, runCommand, getCommand, isVisible, workspace } = await load()
    const run = vi.fn()
    registerCommands([{ id: 'test.graphOnly', title: 'Graph only', menu: ['View'], modes: ['graph'], run }])
    workspace.mode = 'shader'
    expect(isVisible(getCommand('test.graphOnly')!)).toBe(false)
    expect(runCommand('test.graphOnly')).toBe(false)
    expect(run).not.toHaveBeenCalled()
    workspace.mode = 'graph'
    expect(runCommand('test.graphOnly')).toBe(true)
    expect(run).toHaveBeenCalledOnce()
  })

  it('when() hides and enabled() blocks, each on its own', async () => {
    const { registerCommands, runCommand, getCommand, isVisible, isEnabled } = await load()
    const state = { shown: false, usable: false }
    const run = vi.fn()
    registerCommands([{ id: 'test.gated', title: 'Gated', menu: ['View'], when: () => state.shown, enabled: () => state.usable, run }])
    expect(isVisible(getCommand('test.gated')!)).toBe(false)
    state.shown = true
    expect(isVisible(getCommand('test.gated')!)).toBe(true)
    expect(isEnabled(getCommand('test.gated')!)).toBe(false)
    expect(runCommand('test.gated')).toBe(false)
    state.usable = true
    expect(runCommand('test.gated')).toBe(true)
    expect(run).toHaveBeenCalledOnce()
  })

  it('a command without run is disabled until a handler is bound, and again after it is released', async () => {
    const { registerHandlers, runCommand, getCommand, isEnabled } = await load()
    const save = getCommand('file.save')!
    expect(isEnabled(save)).toBe(false)
    expect(runCommand('file.save')).toBe(false)
    const handler = vi.fn()
    const release = registerHandlers({ 'file.save': handler })
    expect(isEnabled(save)).toBe(true)
    expect(runCommand('file.save')).toBe(true)
    expect(handler).toHaveBeenCalledOnce()
    release()
    expect(isEnabled(save)).toBe(false)
  })

  it('a handler that rejects or throws is reported with the command id', async () => {
    const { registerHandlers, runCommand, logs } = await load()
    registerHandlers({
      'file.save': async () => { throw new Error('disk full') },
      'file.saveAs': () => { throw new Error('no dialog') },
    })
    const lines = () => logs.value.map((entry) => `${entry.level}: ${entry.message}`)
    expect(runCommand('file.save')).toBe(true)
    await vi.waitFor(() => expect(lines()).toEqual(['error: command file.save: disk full']))
    expect(runCommand('file.saveAs')).toBe(true)
    await vi.waitFor(() => expect(lines()).toEqual(['error: command file.save: disk full', 'error: command file.saveAs: no dialog']))
  })

  it('releasing an old binding leaves a newer one for the same command alone', async () => {
    const { registerHandlers, runCommand } = await load()
    const first = vi.fn()
    const second = vi.fn()
    const releaseFirst = registerHandlers({ 'file.save': first })
    registerHandlers({ 'file.save': second })
    releaseFirst()
    expect(runCommand('file.save')).toBe(true)
    expect(second).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()
  })

  it('registering an existing id replaces it where it stands; unregistering removes it', async () => {
    const { registerCommands, commands } = await load()
    const before = commands.value.map((command) => command.id)
    const release = registerCommands([{ id: 'file.open', title: 'Open Graph...', menu: ['File'], group: 'document', accelerator: 'Mod+O', run: () => undefined }])
    expect(commands.value.map((command) => command.id)).toEqual(before)
    expect(commands.value.find((command) => command.id === 'file.open')!.title).toBe('Open Graph...')
    release()
    expect(commands.value.some((command) => command.id === 'file.open')).toBe(false)
  })

  it('a command list contributes its members at its own position', async () => {
    const { registerCommands, commands } = await load()
    const names = ['one', 'two']
    registerCommands([{ id: 'file.openRecent', list: () => names.map((name) => ({ id: `file.recent.${name}`, title: name, menu: ['File', 'Open Recent'], group: 'document', run: () => undefined })) }])
    const ids = commands.value.map((command) => command.id)
    expect(ids.slice(ids.indexOf('file.open') + 1, ids.indexOf('file.save'))).toEqual(['file.recent.one', 'file.recent.two'])
  })
})

describe('menu tree', () => {
  const titles = (nodes: MenuNode[]) =>
    nodes.map((node) => (node.type === 'separator' ? '-' : node.type === 'submenu' ? `${node.title} >` : node.command.id))
  const submenu = (nodes: MenuNode[], title: string) => nodes.find((node): node is Submenu => node.type === 'submenu' && node.title === title)!

  it('has exactly File, View and Help in every mode', async () => {
    const { menuTree, workspace } = await load()
    for (const mode of ['shader', 'graph', 'reference'] as const) {
      workspace.mode = mode
      expect(menuTree().map((menu) => menu.title)).toEqual(['File', 'View', 'Help'])
    }
  })

  it('File groups documents, media, config and preferences, with the example list only in shader mode', async () => {
    const { menuTree, workspace } = await load()
    workspace.mode = 'graph'
    expect(titles(menuTree()[0].items)).toEqual([
      'file.new', 'file.open', 'file.openRecent', 'file.save', 'file.saveAs', 'file.revert', 'Export >', '-',
      'Set Audio >', 'Set Image >', '-', 'config.import', 'config.export', '-', 'app.preferences',
    ])
    workspace.mode = 'shader'
    expect(titles(menuTree()[0].items)).toContain('Load Example >')
  })

  it('Set Audio separates the file sources from the capture sources', async () => {
    const { menuTree } = await load()
    expect(titles(submenu(menuTree()[0].items, 'Set Audio').items)).toEqual(['audio.fromFile', 'audio.builtIn', '-', 'audio.microphone', 'audio.system'])
  })

  it('View shows the editor commands of the current mode only', async () => {
    const { menuTree, workspace } = await load()
    const editorIds = () => titles(menuTree()[1].items).filter((id) => /^(shader|graph)\./.test(id))
    workspace.mode = 'shader'
    expect(editorIds()).toEqual(['shader.compile', 'shader.addFunction', 'shader.undo', 'shader.redo', 'shader.selectAll'])
    workspace.mode = 'graph'
    expect(editorIds()).toEqual([
      'graph.addNode', 'graph.searchNodes', 'graph.fitView', 'graph.viewSelected', 'graph.findNode', 'graph.sendToShader', 'graph.copyGlsl',
      'graph.copy', 'graph.cut', 'graph.paste', 'graph.undo', 'graph.redo', 'graph.selectAll', 'graph.deselectAll',
      'graph.invertSelection', 'graph.selectLinkedFrom', 'graph.selectLinkedTo', 'graph.delete',
      'graph.duplicate', 'graph.grab', 'graph.dissolve', 'graph.linkSelected', 'graph.toggleCollapse', 'graph.hideUnusedSockets', 'graph.mute', 'graph.rename',
    ])
    workspace.mode = 'reference'
    expect(editorIds()).toEqual([])
  })

  it('View has one checkbox item per dock, Side Panel and Bottom Panel, and no hide item in any menu', async () => {
    const { commandTitle, isChecked, menuTree, workspace } = await load()
    const flat = (nodes: MenuNode[]): MenuNode[] => nodes.flatMap((node) => (node.type === 'submenu' ? flat(node.items) : [node]))
    for (const mode of ['shader', 'graph', 'reference'] as const) {
      workspace.mode = mode
      const items = flat(menuTree()).flatMap((node) => (node.type === 'item' ? [node.command] : []))
      const docks = items.filter((command) => /^view\.(toggle|hide)/.test(command.id))
      expect(docks.map((command) => [commandTitle(command), command.accelerator, typeof command.checked])).toEqual([['Side Panel', 'Mod+B', 'function'], ['Bottom Panel', 'Mod+J', 'function']])
      const viewItems = items.filter((command) => command.id.startsWith('view.'))
      expect(viewItems.filter((command) => /hide/i.test(`${command.id} ${typeof command.title === 'string' ? command.title : ''}`)).map((command) => command.id)).toEqual([])
      workspace.dockVisible = false
      workspace.bottomVisible = true
      expect(docks.map(isChecked)).toEqual([false, true])
      workspace.dockVisible = true
    }
  })

  it('Show Panel offers the tabs that exist in the mode', async () => {
    const { menuTree, workspace } = await load()
    const panels = () => titles(submenu(menuTree()[1].items, 'Show Panel').items)
    workspace.mode = 'reference'
    expect(panels()).toEqual(['view.panel.output', 'view.panel.inputs', 'view.panel.log', 'view.panel.performance'])
    workspace.mode = 'graph'
    expect(panels()).toEqual(['view.panel.parameters', 'view.panel.output', 'view.panel.inputs', 'view.panel.problems', 'view.panel.log', 'view.panel.glsl', 'view.panel.performance'])
  })

  it('context menu items carry title, keys and disabled state, and drop what is hidden or unknown', async () => {
    const { contextMenuItems, workspace } = await load()
    workspace.mode = 'shader'
    const groups = contextMenuItems([['view.toggleDock', 'file.save', 'graph.fitView', 'nope'], ['graph.copy']])
    expect(groups).toHaveLength(1)
    expect(groups[0].map(({ onSelect, ...rest }) => rest)).toEqual([
      { label: 'Side Panel', kbds: ['meta', 'b'], disabled: false, type: 'checkbox', checked: true },
      { label: 'Save', kbds: ['meta', 's'], disabled: true },
    ])
    groups[0][0].onSelect()
    expect(workspace.dockVisible).toBe(false)
  })
})

describe('the whole registry', () => {
  const listed = /^(shader\.example|output\.device)\./

  it('every command has a control, and every command outside a live list has an accelerator', async () => {
    const { commands } = await load()
    expect(commands.value.length).toBeGreaterThan(40)
    for (const command of commands.value) {
      expect(command.menu.length, command.id).toBeGreaterThan(0)
      if (!listed.test(command.id)) expect(command.accelerator, command.id).toMatch(/\S/)
    }
  })

  it('ids are unique', async () => {
    const { commands } = await load()
    const ids = commands.value.map((command) => command.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // the registry reads the platform when it loads: Ctrl+Y is a redo alias only off macOS
  for (const platform of ['MacIntel', 'Win32', 'Linux x86_64']) {
    it(`no two commands of one mode share an accelerator or an alias (${platform})`, async () => {
      const realNavigator = navigator
      vi.stubGlobal('navigator', { platform })
      try {
        const { commands, isMac, isVisible, parseAccelerator, workspace } = await load()
        // off macOS a literal Ctrl accelerator is the Mod one
        const normal = (text: string) => {
          const { mod, ctrl, ...rest } = parseAccelerator(text)
          return JSON.stringify(isMac() ? { mod, ctrl, ...rest } : { mod: mod || ctrl, ...rest })
        }
        for (const mode of ['shader', 'graph', 'reference'] as const) {
          workspace.mode = mode
          const seen = new Map<string, string>()
          for (const command of commands.value.filter(isVisible)) {
            for (const text of [command.accelerator, ...(command.aliases ?? [])]) {
              if (!text) continue
              expect(seen.get(normal(text)), `${mode}: ${text} on ${command.id}`).toBeUndefined()
              seen.set(normal(text), command.id)
            }
          }
        }
      } finally {
        vi.stubGlobal('navigator', realNavigator)
      }
    })
  }

  it('graph redo answers Ctrl+Y on Windows and Linux, and Cmd+Y stays free on macOS', async () => {
    const realNavigator = navigator
    try {
      for (const [platform, aliases] of [['MacIntel', undefined], ['Win32', ['Mod+Y']], ['Linux x86_64', ['Mod+Y']]] as const) {
        vi.stubGlobal('navigator', { platform })
        const { getCommand } = await load()
        expect(getCommand('graph.redo')!.aliases, platform).toEqual(aliases)
      }
    } finally {
      vi.stubGlobal('navigator', realNavigator)
    }
  })

  it('every command on a text editing chord is a text key, so text fields and the code editor keep that chord', async () => {
    const { commands, parseAccelerator } = await load()
    const textChords = ['Mod+A', 'Mod+C', 'Mod+X', 'Mod+V', 'Mod+Z', 'Mod+Shift+Z', 'Mod+Y'].map((text) => JSON.stringify(parseAccelerator(text)))
    for (const command of commands.value) {
      for (const text of [command.accelerator, ...(command.aliases ?? [])]) {
        if (text && textChords.includes(JSON.stringify(parseAccelerator(text)))) expect(command.textKey, `${command.id}: ${text}`).toBe(true)
      }
    }
  })
})

describe('log, problems, dock-hide and reference commands', () => {
  it('log.copyLine copies the context row, log.copyAll copies what is shown, log.clear empties it', async () => {
    const { getCommand, isEnabled, log, logContext, logs, runCommand, setClipboardWriter } = await load()
    const written: string[] = []
    setClipboardWriter((text) => { written.push(text) })

    expect(isEnabled(getCommand('log.copyLine')!)).toBe(false)
    expect(isEnabled(getCommand('log.copyAll')!)).toBe(false)
    log('first')
    log('second')
    expect(isEnabled(getCommand('log.copyAll')!)).toBe(true)

    logContext.value = logs.value[0]
    expect(isEnabled(getCommand('log.copyLine')!)).toBe(true)
    runCommand('log.copyLine')
    expect(written).toHaveLength(1)
    expect(written[0]).toContain('first')

    runCommand('log.copyAll')
    expect(written[1]).toContain('first')
    expect(written[1]).toContain('second')

    runCommand('log.clear')
    expect(logs.value).toEqual([])
  })

  it('problems.copyMessage copies the row set by a right-click, and problems.goto\'s title tracks what kind of problem it is', async () => {
    const { commandTitle, contextProblem, getCommand, isEnabled, registerHandlers, runCommand, setClipboardWriter } = await load()
    const written: string[] = []
    setClipboardWriter((text) => { written.push(text) })

    expect(isEnabled(getCommand('problems.copyMessage')!)).toBe(false)
    contextProblem.value = { message: 'bad thing', line: 12 }
    expect(isEnabled(getCommand('problems.copyMessage')!)).toBe(true)
    runCommand('problems.copyMessage')
    expect(written).toEqual(['bad thing'])
    expect(commandTitle(getCommand('problems.goto')!)).toBe('Go to Line')

    contextProblem.value = { message: 'node broke', nodeId: 'n1' }
    expect(commandTitle(getCommand('problems.goto')!)).toBe('Reveal Node')

    // problems.goto has no static run: the mounted ProblemsList supplies it via registerHandlers
    const goto = vi.fn()
    const release = registerHandlers({ 'problems.goto': goto })
    expect(isEnabled(getCommand('problems.goto')!)).toBe(true)
    runCommand('problems.goto')
    expect(goto).toHaveBeenCalledOnce()
    release()
  })

  it('the hide commands of the dock tab context menu say which panel, and the native menu binds no key for what it does not show', async () => {
    const { commandTitle, contextMenuItems, getCommand, nativeAccelerator } = await load()
    expect(contextMenuItems([['view.hideDock'], ['view.hideBottom']]).map((group) => group[0].label)).toEqual(['Hide Side Panel', 'Hide Bottom Panel'])
    for (const id of ['view.hideDock', 'view.hideBottom']) {
      expect(commandTitle(getCommand(id)!)).not.toBe('Hide Panel')
      expect(nativeAccelerator(getCommand(id)!)).toBeUndefined()
    }
  })

  it('Cmd+A selects all in both editors; adding is Shift+A in a graph and Cmd+Shift+A in a shader; no native item binds them', async () => {
    const { getCommand, nativeAccelerator } = await load()
    const keys = (id: string) => { const { accelerator, aliases, textKey, modes } = getCommand(id)!; return { accelerator, aliases, textKey, modes } }
    expect(keys('graph.addNode')).toEqual({ accelerator: 'Shift+A', aliases: undefined, textKey: undefined, modes: ['graph'] })
    expect(keys('graph.selectAll')).toEqual({ accelerator: 'Mod+A', aliases: undefined, textKey: true, modes: ['graph'] })
    expect(keys('graph.deselectAll')).toEqual({ accelerator: 'Alt+A', aliases: ['Escape'], textKey: undefined, modes: ['graph'] })
    expect(keys('shader.selectAll')).toEqual({ accelerator: 'Mod+A', aliases: undefined, textKey: true, modes: ['shader'] })
    expect(keys('shader.addFunction')).toEqual({ accelerator: 'Mod+Shift+A', aliases: undefined, textKey: true, modes: ['shader'] })
    for (const id of ['graph.addNode', 'graph.selectAll', 'graph.deselectAll', 'shader.selectAll', 'shader.addFunction']) expect(nativeAccelerator(getCommand(id)!), id).toBeUndefined()
  })

  it('N is the side panel key in a graph only', async () => {
    const { getCommand, workspace } = await load()
    workspace.mode = 'graph'
    expect(getCommand('view.toggleDock')!.aliases).toEqual(['N'])
    workspace.mode = 'shader'
    expect(getCommand('view.toggleDock')!.aliases).toBeUndefined()
  })

  it('view.maximize hides every panel around the editor, and brings back only what it hid', async () => {
    const { getCommand, isChecked, runCommand, workspace } = await load()
    Object.assign(workspace, { dockVisible: true, bottomVisible: false, stripVisible: true })
    runCommand('view.maximize')
    expect([workspace.dockVisible, workspace.bottomVisible, workspace.stripVisible, isChecked(getCommand('view.maximize')!)]).toEqual([false, false, false, true])
    runCommand('view.maximize')
    expect([workspace.dockVisible, workspace.bottomVisible, workspace.stripVisible, isChecked(getCommand('view.maximize')!)]).toEqual([true, false, true, false])
  })

  it('view.hideDock and view.hideBottom force their panel closed, unlike the toggle commands', async () => {
    const { getCommand, runCommand, workspace } = await load()
    workspace.dockVisible = true
    workspace.bottomVisible = true
    expect(getCommand('view.hideDock')!.checked).toBeUndefined()
    runCommand('view.hideDock')
    runCommand('view.hideDock')
    expect(workspace.dockVisible).toBe(false)
    runCommand('view.hideBottom')
    expect(workspace.bottomVisible).toBe(false)
  })

  it('reference.focusSearch and reference.copyEntry exist only in reference mode; Cmd+C is a text key', async () => {
    const { getCommand } = await load()
    const focusSearch = getCommand('reference.focusSearch')!
    const copyEntry = getCommand('reference.copyEntry')!
    expect(focusSearch.modes).toEqual(['reference'])
    expect(focusSearch.accelerator).toBe('/')
    expect(focusSearch.aliases).toEqual(['Mod+F'])
    expect(copyEntry.modes).toEqual(['reference'])
    expect(copyEntry.textKey).toBe(true)
  })

  it('File > New names the document of the mode, and Export exists where there is a shader to export', async () => {
    const { commandTitle, getCommand, isVisible, isEnabled, workspace } = await load()
    const visible = (mode: 'shader' | 'graph' | 'reference') => {
      workspace.mode = mode
      return isVisible(getCommand('file.exportGlsl')!)
    }
    expect([visible('shader'), visible('graph'), visible('reference')]).toEqual([true, true, false])
    expect(isEnabled(getCommand('file.exportGlsl')!)).toBe(true)
    workspace.mode = 'shader'
    expect(commandTitle(getCommand('file.new')!)).toBe('New Shader')
    workspace.mode = 'graph'
    expect(commandTitle(getCommand('file.new')!)).toBe('New Graph')
  })

  it('graph.copyGlsl exists only in graph mode and needs a page handler to run', async () => {
    const { getCommand, isEnabled } = await load()
    const command = getCommand('graph.copyGlsl')!
    expect(command.modes).toEqual(['graph'])
    expect(isEnabled(command)).toBe(false)
  })
})

describe('native menu', () => {
  it('the window keeps its own menubar, under Tauri on macOS too, until the shell reports a native menu', async () => {
    const realNavigator = navigator
    vi.stubGlobal('window', { addEventListener: () => undefined, __TAURI_INTERNALS__: {} })
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
    try {
      const { hasNativeMenu, isMac, markNativeMenuInstalled } = await load()
      expect(isMac()).toBe(true)
      expect(hasNativeMenu()).toBe(false)
      markNativeMenuInstalled()
      expect(hasNativeMenu()).toBe(true)
    } finally {
      vi.stubGlobal('window', { addEventListener: () => undefined })
      vi.stubGlobal('navigator', realNavigator)
    }
  })
})
