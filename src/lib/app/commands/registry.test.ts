import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuNode, Submenu } from './registry'

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
    ...(await import('@/lib/app/commands')),
    ...(await import('@/lib/app/workspace')),
    ...(await import('@/lib/app/logs')),
    ...(await import('@/lib/app/files/clipboard')),
  }
}

// the first import transforms the engine and everything it pulls in, which alone can outlast a test's timeout under a full run
beforeAll(() => import('@/lib/app/commands'), 30_000)
beforeEach(() => stored.clear())
afterEach(() => vi.restoreAllMocks())

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
