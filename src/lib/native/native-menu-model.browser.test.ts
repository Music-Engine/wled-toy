import { describe, expect, it } from 'vitest'
import { commands, isVisible } from '@/lib/app/commands'
// replaces the Open Recent placeholder with the list, as the app does
import '@/lib/graph/model/document'
import { createNativeMenu } from './native-menu'
import { workspace } from '@/lib/app/workspace'
import { fakeMenuApi, useMacDesktop } from '@/test/native-menu'

useMacDesktop()

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

