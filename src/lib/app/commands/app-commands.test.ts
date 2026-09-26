import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

