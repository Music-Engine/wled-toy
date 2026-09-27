import { afterEach, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createApp, h, nextTick } from 'vue'
import AppMenuBar from './AppMenuBar.vue'
import { formatAccelerator, registerHandlers } from '@/lib/app/commands'
import { resetLayout, workspace } from '@/lib/app/workspace'

const cleanups: Array<() => void> = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  resetLayout()
  workspace.mode = 'shader'
})

function mount() {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(AppMenuBar) })
  app.mount(root)
  cleanups.push(() => { app.unmount(); root.remove() })
  return root
}

const trigger = (root: HTMLElement, title: string) => [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent!.trim() === title)!
const entry = (id: string) => document.querySelector<HTMLElement>(`[role="menu"] [data-command="${id}"]`)

it('shows exactly File, View and Help, as text', () => {
  const root = mount()
  expect([...root.querySelectorAll('.app-menubar > *')].map((el) => el.textContent!.trim())).toEqual(['File', 'View', 'Help'])
  expect(root.querySelector('svg, [class*="i-lucide"]')).toBeNull()
})

it('an item runs its command, shows its accelerator, and its check follows the state', async () => {
  const root = mount()
  await userEvent.click(trigger(root, 'View'))
  const dock = entry('view.toggleDock')!
  expect(dock.textContent).toContain('Side Panel')
  expect(dock.textContent).toContain(formatAccelerator('Mod+B'))
  expect([dock.getAttribute('role'), dock.getAttribute('aria-checked')]).toEqual(['menuitemcheckbox', 'true'])
  await userEvent.click(dock)
  expect(workspace.dockVisible).toBe(false)
  expect(document.querySelector('[role="menu"]')).toBeNull()

  await userEvent.click(trigger(root, 'View'))
  expect(entry('view.toggleDock')!.getAttribute('aria-checked')).toBe('false')
  await userEvent.keyboard('{Escape}')
})

it('a command without a handler is disabled until one is bound', async () => {
  const root = mount()
  await userEvent.click(trigger(root, 'File'))
  expect(entry('file.save')!.hasAttribute('data-disabled')).toBe(true)
  expect(entry('config.export')!.hasAttribute('data-disabled')).toBe(false)
  await userEvent.keyboard('{Escape}')

  const save = vi.fn()
  cleanups.push(registerHandlers({ 'file.save': save }))
  await userEvent.click(trigger(root, 'File'))
  await userEvent.click(entry('file.save')!)
  expect(save).toHaveBeenCalledOnce()
})

it('the editor commands follow the mode', async () => {
  const root = mount()
  await userEvent.click(trigger(root, 'View'))
  expect(entry('shader.compile')).not.toBeNull()
  expect(entry('graph.addNode')).toBeNull()
  await userEvent.keyboard('{Escape}')

  workspace.mode = 'graph'
  await nextTick()
  await userEvent.click(trigger(root, 'View'))
  expect(entry('shader.compile')).toBeNull()
  expect(entry('graph.addNode')!.textContent).toContain(formatAccelerator('Shift+A'))
  await userEvent.keyboard('{Escape}')
})

it('a submenu opens from the keyboard and runs its item', async () => {
  workspace.bottomVisible = false
  const root = mount()
  await userEvent.click(trigger(root, 'View'))
  const panels = [...document.querySelectorAll<HTMLElement>('[role="menu"] [aria-haspopup="menu"]')].find((el) => el.textContent!.includes('Show Panel'))!
  panels.focus()
  await userEvent.keyboard('{ArrowRight}')
  await expect.poll(() => entry('view.panel.log')).not.toBeNull()
  await userEvent.click(entry('view.panel.log')!)
  expect(workspace.bottomVisible).toBe(true)
  expect(workspace.activeTab.bottom.shader).toBe('log')
})
