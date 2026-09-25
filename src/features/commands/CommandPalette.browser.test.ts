import { afterEach, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createApp, h, nextTick } from 'vue'
import CommandPalette from './CommandPalette.vue'
import { isMac, palette, runCommand } from '@/lib/app/commands'
import { resetLayout, workspace } from '@/lib/app/workspace'

let unmount: (() => void) | undefined
afterEach(() => {
  palette.open = false
  unmount?.()
  resetLayout()
})

function mount() {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(CommandPalette) })
  app.mount(root)
  unmount = () => { app.unmount(); root.remove() }
}

const rows = () => [...document.querySelectorAll<HTMLElement>('.command-palette [data-command]')].map((el) => el.dataset.command)
const input = () => document.querySelector<HTMLInputElement>('.command-palette input')!

it('opens from its command with the filter focused and offers only what can run', async () => {
  mount()
  expect(document.querySelector('.command-palette')).toBeNull()
  runCommand('view.commandPalette')
  await expect.poll(() => document.activeElement === input()).toBe(true)
  expect(rows()).toContain('view.toggleBottom')
  expect(rows()).toContain('shader.example.Fire')
  expect(rows()).not.toContain('file.save')
  expect(rows()).not.toContain('graph.fitView')
})

it('filters by every typed word over menu path and title, and Enter runs the first match', async () => {
  mount()
  runCommand('view.commandPalette')
  await expect.poll(() => document.activeElement === input()).toBe(true)
  await userEvent.fill(input(), 'image built')
  await expect.poll(rows).toEqual(['image.builtIn'])
  // Hide Bottom Panel matches too, and belongs to the dock tab context menu alone
  await userEvent.fill(input(), 'bottom pan')
  await expect.poll(rows).toEqual(['view.toggleBottom'])
  await expect.poll(() => document.querySelector('.command-palette [data-command][data-highlighted]')).not.toBeNull()
  await userEvent.keyboard('{Enter}')
  expect(workspace.bottomVisible).toBe(true)
  await expect.poll(() => document.querySelector('.command-palette')).toBeNull()
})

it('says so when nothing matches', async () => {
  mount()
  runCommand('view.commandPalette')
  await expect.poll(() => document.activeElement === input()).toBe(true)
  await userEvent.fill(input(), 'zzzz')
  await expect.poll(rows).toEqual([])
  expect(document.querySelector('.command-palette')!.textContent).toContain('No matching commands')
})

it('a click runs the command and closes the palette', async () => {
  mount()
  runCommand('view.commandPalette')
  await expect.poll(() => rows().length).toBeGreaterThan(0)
  await userEvent.click(document.querySelector('.command-palette [data-command="view.toggleDock"]')!)
  expect(workspace.dockVisible).toBe(false)
  await expect.poll(() => document.querySelector('.command-palette')).toBeNull()
})

it('its own accelerator closes it again', async () => {
  mount()
  runCommand('view.commandPalette')
  await expect.poll(() => document.activeElement === input()).toBe(true)
  await userEvent.keyboard(isMac() ? '{Meta>}k{/Meta}' : '{Control>}k{/Control}')
  await expect.poll(() => document.querySelector('.command-palette')).toBeNull()
})

it('as the shortcut list it also shows commands that cannot run now, disabled', async () => {
  mount()
  runCommand('help.shortcuts')
  await expect.poll(() => rows().length).toBeGreaterThan(0)
  expect(rows()).toContain('shader.compile')
  expect(rows()).not.toContain('shader.example.Fire')
  const save = document.querySelector('.command-palette [data-command="file.save"]')!
  expect(save.hasAttribute('data-disabled')).toBe(true)
  await nextTick()
  expect(input().placeholder).toBe('Search keyboard shortcuts')
})
