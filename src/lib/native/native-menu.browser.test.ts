import { nextTick, reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { hasNativeMenu, registerCommands, registerHandlers } from '@/lib/app/commands'
// replaces the Open Recent placeholder with the list, as the app does
import '@/lib/graph/model/document'
import { createNativeMenu, installNativeMenu } from './native-menu'
import { workspace } from '@/lib/app/workspace'
import { cleanups, fakeMenuApi, setPlatform, setTauri, useMacDesktop } from '@/test/native-menu'

useMacDesktop()

describe('native items', () => {
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
