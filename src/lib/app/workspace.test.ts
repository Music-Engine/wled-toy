import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

const stored = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) })

// a fresh module instance reads localStorage again, which is what a reload does
async function reload() {
  vi.resetModules()
  return import('./workspace')
}

beforeEach(() => stored.clear())

describe('sanitize', () => {
  it('clamps sizes to the dock limits and rejects what is not a number', async () => {
    const { sanitize } = await reload()
    expect(sanitize({ dockWidth: 9000, bottomHeight: 3 })).toMatchObject({ dockWidth: 560, bottomHeight: 120 })
    expect(sanitize({ dockWidth: '400', bottomHeight: null })).toMatchObject({ dockWidth: 360, bottomHeight: 220 })
  })

  it('the LED strip shows unless a stored layout hid it', async () => {
    const { sanitize } = await reload()
    expect([sanitize({}).stripVisible, sanitize({ stripVisible: false }).stripVisible, sanitize({ stripVisible: 'no' }).stripVisible]).toEqual([true, false, true])
  })

  it('keeps a known preview view and falls back to the render for anything else', async () => {
    const { sanitize } = await reload()
    expect(sanitize({ previewView: 'leds' }).previewView).toBe('leds')
    expect(sanitize({ previewView: 'topology' }).previewView).toBe('render')
  })

  it('drops unknown tabs, docks and modes and keeps the valid entries next to them', async () => {
    const { sanitize } = await reload()
    const layout = sanitize({
      placement: { log: 'right', glsl: 'left', nonsense: 'bottom' },
      activeTab: { right: { graph: 'log', shader: 'nonsense', settings: 'log' }, bottom: 'log' },
    })
    expect(layout.placement).toEqual({ parameters: 'right', output: 'right', inputs: 'right', problems: 'bottom', log: 'right', glsl: 'bottom', performance: 'bottom' })
    expect(layout.activeTab).toEqual({ right: { graph: 'log' }, bottom: {} })
  })
})

describe('persistence', () => {
  it('sizes, visibility, tab placement and tab choice come back after a reload; mode and problem count do not', async () => {
    const first = await reload()
    first.workspace.mode = 'graph'
    first.workspace.problemCount = 3
    first.workspace.dockWidth = 420
    first.workspace.bottomHeight = 300
    first.moveTab('glsl', 'right')
    first.selectTab('log')
    first.workspace.dockVisible = false
    first.workspace.bottomVisible = true
    await nextTick()

    const second = await reload()
    expect(second.workspace).toMatchObject({ dockWidth: 420, bottomHeight: 300, dockVisible: false, bottomVisible: true, mode: 'shader', problemCount: 0 })
    expect(second.workspace.placement.glsl).toBe('right')
    expect(second.workspace.activeTab).toEqual({ right: { graph: 'glsl' }, bottom: { graph: 'log' } })
  })

  it('a corrupt stored value falls back to the default layout', async () => {
    stored.set('wledtoy:workspace', '{not json')
    const { workspace } = await reload()
    expect(workspace).toMatchObject({ dockWidth: 360, dockVisible: true, bottomHeight: 220, bottomVisible: false })
  })

  it('resetLayout restores the defaults and persists them', async () => {
    const { workspace, moveTab, resetLayout } = await reload()
    moveTab('log', 'right')
    workspace.dockWidth = 500
    await nextTick()
    resetLayout()
    await nextTick()
    expect(JSON.parse(stored.get('wledtoy:workspace')!)).toMatchObject({ dockWidth: 360, placement: { log: 'bottom' } })
  })
})

describe('tabs', () => {
  it('a dock lists only the tabs placed in it that belong to the current mode', async () => {
    const { workspace, visibleTabs } = await reload()
    const ids = (dock: 'right' | 'bottom') => visibleTabs(dock).map((tab) => tab.id)
    workspace.mode = 'shader'
    expect([ids('right'), ids('bottom')]).toEqual([['output', 'inputs'], ['problems', 'log', 'performance']])
    workspace.mode = 'graph'
    expect([ids('right'), ids('bottom')]).toEqual([['parameters', 'output', 'inputs'], ['problems', 'log', 'glsl', 'performance']])
    workspace.mode = 'reference'
    expect([ids('right'), ids('bottom')]).toEqual([['output', 'inputs'], ['log', 'performance']])
  })

  it('each mode remembers its own tab, and a remembered tab that is not showing yields the first one', async () => {
    const { workspace, activeTab, selectTab, moveTab } = await reload()
    workspace.mode = 'graph'
    selectTab('glsl')
    workspace.mode = 'shader'
    expect(activeTab('bottom')).toBe('problems')
    selectTab('log')
    workspace.mode = 'graph'
    expect(activeTab('bottom')).toBe('glsl')
    moveTab('glsl', 'right')
    expect(activeTab('bottom')).toBe('problems')
    expect(activeTab('right')).toBe('glsl')
    workspace.mode = 'reference'
    expect(activeTab('right')).toBe('output')
    moveTab('output', 'bottom')
    moveTab('inputs', 'bottom')
    expect(activeTab('right')).toBeNull()
  })

  it('showTab opens the dock the tab lives in, wherever it was moved', async () => {
    const { workspace, showTab, moveTab } = await reload()
    workspace.mode = 'graph'
    showTab('problems')
    expect(workspace.bottomVisible).toBe(true)
    moveTab('problems', 'right')
    workspace.dockVisible = false
    workspace.bottomVisible = false
    showTab('problems')
    expect([workspace.dockVisible, workspace.bottomVisible]).toEqual([true, false])
  })
})
