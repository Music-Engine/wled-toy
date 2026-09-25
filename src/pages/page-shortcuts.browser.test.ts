import { afterEach, beforeEach, expect, it } from 'vitest'
import { createApp, h, KeepAlive, type Component } from 'vue'
import { routerKey, type Router } from 'vue-router'
import { useVueFlow } from '@vue-flow/core'
import GraphPage from './GraphPage.vue'
import ReferencePage from './ReferencePage.vue'
import ShaderPage from './ShaderPage.vue'
import { setClipboardWriter } from '@/lib/app/clipboard'
import { commands, dispatchKey, isVisible } from '@/lib/app/commands'
import { config } from '@/lib/app/config'
import { createDefaultGraph } from '@/lib/graph'
import { graphFileBackendKey } from '@/lib/graph/model/document'
import { workspace, type Mode } from '@/lib/app/workspace'
import { press } from '@/test/keys'

const cleanups: Array<() => void> = []
let ran: boolean[] = []

beforeEach(() => {
  for (const key of ['wledtoy:graph:recent', 'wledtoy:graph:recovery']) localStorage.removeItem(key)
  config.graph = null
  setClipboardWriter(() => undefined)
})

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  config.graph = null
  workspace.mode = 'shader'
  setClipboardWriter((text) => { void navigator.clipboard.writeText(text) })
})

/** The page as the app shows it, with the app's dispatcher answering keys on window; `ran` collects what each key did. */
function mount(page: Component, mode: Mode) {
  workspace.mode = mode
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h('div', { style: 'width: 1000px; height: 600px' }, h(KeepAlive, null, () => h(page))) })
  app.provide(graphFileBackendKey, { open: async () => null, save: async () => undefined, saveAs: async () => null })
  app.provide(routerKey, { push: async () => undefined } as unknown as Router)
  // Nuxt UI is not installed here; the page's own buttons render as unknown elements
  app.config.warnHandler = () => undefined
  app.mount(root)
  const onKeydown = (e: KeyboardEvent) => void ran.push(dispatchKey(e))
  window.addEventListener('keydown', onKeydown)
  cleanups.push(() => { window.removeEventListener('keydown', onKeydown); app.unmount(); root.remove() })
}

const dialogOpen = () => !!document.querySelector('[role="dialog"]')
// a grab, a title being edited and the node finder each wait for Escape, and hold the keys that follow until then
const modal = () => dialogOpen() || !!document.querySelector('.is-grabbing, .nui-rename')

/** Presses every key of every command of the page and returns the keys that ran nothing. */
async function pressEvery(prefix: string) {
  const missed: string[] = []
  const pressed = new Set<string>()
  for (const command of commands.value.filter((c) => c.id.startsWith(prefix) && c.accelerator && isVisible(c))) {
    for (const text of [command.accelerator!, ...(command.aliases ?? [])]) {
      ran = []
      const event = press(text)
      if (!(event.defaultPrevented && ran.includes(true))) missed.push(`${command.id} ${text}`)
      pressed.add(command.id)
      // the node menu an add command opens is a dialog, under which no key runs; a duplicate starts its grab a tick later
      await new Promise((resolve) => setTimeout(resolve))
      const menu = document.querySelector('.node-menu')?.parentElement
      menu?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      if (!menu && modal()) press('Escape', document.activeElement ?? document.body)
      await expect.poll(modal).toBe(false)
    }
  }
  return { missed, pressed: [...pressed] }
}

it('every graph shortcut runs its command on the graph page', async () => {
  mount(GraphPage, 'graph')
  await expect.poll(() => document.querySelectorAll('.vue-flow__node').length).toBe(createDefaultGraph().nodes.length)
  const { missed, pressed } = await pressEvery('graph.')
  expect(missed).toEqual([])
  expect(pressed).toEqual(expect.arrayContaining([
    'graph.addNode', 'graph.searchNodes', 'graph.copy', 'graph.cut', 'graph.paste', 'graph.undo', 'graph.redo', 'graph.selectAll', 'graph.deselectAll', 'graph.delete',
    'graph.duplicate', 'graph.grab', 'graph.toggleCollapse', 'graph.hideUnusedSockets', 'graph.mute', 'graph.dissolve', 'graph.linkSelected',
    'graph.invertSelection', 'graph.selectLinkedFrom', 'graph.selectLinkedTo', 'graph.viewSelected', 'graph.rename', 'graph.findNode',
  ]))
})

it('every shader shortcut runs its command on the shader page', async () => {
  mount(ShaderPage, 'shader')
  await expect.poll(() => document.querySelector('.cm-content')).not.toBeNull()
  const { missed, pressed } = await pressEvery('shader.')
  expect(missed).toEqual([])
  expect(pressed).toEqual(['shader.compile', 'shader.addFunction', 'shader.undo', 'shader.redo', 'shader.selectAll'])
})

it('every reference shortcut runs its command on the reference page', async () => {
  mount(ReferencePage, 'reference')
  const { missed, pressed } = await pressEvery('reference.')
  expect(missed).toEqual([])
  expect(pressed).toEqual(['reference.focusSearch', 'reference.copyEntry'])
})

it('Delete removes the selection through graph.delete alone, as one undo step', async () => {
  mount(GraphPage, 'graph')
  const flow = useVueFlow('wledtoy-graph')
  const all = createDefaultGraph()
  await expect.poll(() => flow.getNodes.value.length).toBe(all.nodes.length)
  const linked = flow.getNodes.value.find((n) => flow.edges.value.some((e) => e.source === n.id || e.target === n.id))!
  flow.addSelectedNodes([linked])
  const counts = () => [flow.getNodes.value.length, flow.edges.value.length]
  // a change becomes one undo step once it has paused
  const settle = () => new Promise((resolve) => setTimeout(resolve, 450))

  // the canvas's own delete key is off: without the command registry the key does nothing
  workspace.mode = 'reference'
  press('Delete')
  await settle()
  expect(counts()).toEqual([all.nodes.length, all.edges.length])

  workspace.mode = 'graph'
  expect(press('Delete').defaultPrevented).toBe(true)
  await expect.poll(counts).not.toEqual([all.nodes.length, all.edges.length])
  expect(flow.findNode(linked.id)).toBeUndefined()
  await settle()

  press('Mod+Z')
  await expect.poll(counts).toEqual([all.nodes.length, all.edges.length])
  await settle()
  press('Mod+Z')
  await settle()
  expect(counts()).toEqual([all.nodes.length, all.edges.length])
})
