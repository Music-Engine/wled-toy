import { afterEach, beforeEach, expect, it } from 'vitest'
import { useVueFlow } from '@vue-flow/core'
import { config } from '@/lib/app/config'
import { createDefaultGraph, type GraphNodeData } from '@/lib/graph'
import { resetLayout, workspace } from '@/lib/app/workspace'
import { mountGraphPage } from '@/test/graph-page'
import { press } from '@/test/keys'

let unmount: (() => void) | undefined
const flow = useVueFlow('wledtoy-graph')
const defaults = createDefaultGraph()

beforeEach(async () => {
  unmount = await mountGraphPage()
})

afterEach(() => {
  unmount?.()
  config.graph = null
  workspace.mode = 'shader'
  resetLayout()
})

async function select(...ids: string[]) {
  flow.removeSelectedElements()
  flow.addSelectedNodes(ids.map((id) => flow.findNode(id)!))
  await expect.poll(selected).toEqual([...ids].sort())
}

const selected = () => flow.getSelectedNodes.value.map((n) => n.id).sort()
const data = (id: string) => flow.findNode(id)!.data as GraphNodeData
const nodeEl = (id: string) => document.querySelector<HTMLElement>(`.vue-flow__node[data-id="${id}"]`)!
const shell = (id: string) => nodeEl(id).querySelector('.nui-node')!.classList
const linked = (source: string, target: string) => flow.edges.value.some((e) => e.source === source && e.target === target)
// a change becomes one undo step once it has paused
const settle = () => new Promise((resolve) => setTimeout(resolve, 450))
const pointer = (type: string, x: number, y: number) => document.querySelector('.vue-flow')!.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true }))

it('G moves the selection with the pointer; Escape puts it back and records nothing, a click drops it as one undo step', async () => {
  await select('mix')
  const [origin, zoom] = [{ ...flow.findNode('mix')!.position }, flow.viewport.value.zoom]
  pointer('pointermove', 300, 300)
  press('G')
  await expect.poll(() => !!document.querySelector('.is-grabbing')).toBe(true)
  pointer('pointermove', 400, 300)
  expect(flow.findNode('mix')!.position.x).toBeCloseTo(origin.x + 100 / zoom)
  await settle()
  press('Escape')
  expect(flow.findNode('mix')!.position).toEqual(origin)
  // the Escape was the grab's, not graph.deselectAll's
  expect(selected()).toEqual(['mix'])
  await settle()
  press('G')
  pointer('pointermove', 350, 340)
  await settle()
  pointer('pointermove', 400, 340)
  document.querySelector('.vue-flow__pane')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await expect.poll(() => document.querySelector('.is-grabbing')).toBeNull()
  expect(flow.findNode('mix')!.position.y).toBeCloseTo(origin.y + 40 / zoom)
  await settle()
  press('Mod+Z')
  await expect.poll(() => flow.findNode('mix')!.position).toEqual(origin)
  await settle()
  press('Mod+Z')
  await settle()
  expect(flow.findNode('mix')!.position).toEqual(origin)
})

it('Shift+D copies the selection with its inner links, selects the copies and grabs them', async () => {
  await select('speed', 'offset')
  press('Shift+D')
  await expect.poll(() => flow.getNodes.value.length).toBe(defaults.nodes.length + 2)
  await expect.poll(() => !!document.querySelector('.is-grabbing')).toBe(true)
  const copies = selected()
  expect(copies.some((id) => id === 'speed' || id === 'offset')).toBe(false)
  expect(copies.map((id) => data(id).kind)).toEqual(['math', 'math'])
  expect(flow.edges.value.filter((e) => copies.includes(e.source) && copies.includes(e.target))).toHaveLength(1)
  press('Escape')
  await expect.poll(() => document.querySelector('.is-grabbing')).toBeNull()
})

it('H folds the selected nodes and unfolds them again, leaving no flag behind', async () => {
  await select('speed', 'lift')
  press('H')
  await expect.poll(() => shell('speed').contains('is-collapsed')).toBe(true)
  expect(data('lift').collapsed).toBe(true)
  press('H')
  await expect.poll(() => shell('speed').contains('is-collapsed')).toBe(false)
  expect(JSON.stringify(data('speed'))).not.toContain('collapsed')
})

it('Ctrl+H hides the unlinked sockets of the selection and keeps the linked ones', async () => {
  await select('speed')
  press('Ctrl+H')
  await expect.poll(() => nodeEl('speed').querySelector('[data-handleid="b"]')).toBeNull()
  expect(nodeEl('speed').querySelector('[data-handleid="a"]')).not.toBeNull()
  expect(nodeEl('speed').querySelector('[data-handleid="result"]')).not.toBeNull()
  await select('time')
  press('Ctrl+H')
  await expect.poll(() => nodeEl('time').querySelector('[data-handleid="delta"]')).toBeNull()
  expect(nodeEl('time').querySelector('[data-handleid="time"]')).not.toBeNull()
})

it('M mutes the selected nodes and dims them, and unmutes them leaving no flag behind', async () => {
  await select('lift')
  press('M')
  await expect.poll(() => shell('lift').contains('is-muted')).toBe(true)
  expect(data('lift').muted).toBe(true)
  press('M')
  await expect.poll(() => shell('lift').contains('is-muted')).toBe(false)
  expect(JSON.stringify(data('lift'))).not.toContain('muted')
})

it('Cmd+X, as a key or as the native Cut item\'s cut event, dissolves the selection and joins what fed it to what it fed', async () => {
  await select('speed')
  expect(press('Mod+X').defaultPrevented).toBe(true)
  await expect.poll(() => flow.findNode('speed')).toBeUndefined()
  expect(flow.edges.value.some((e) => e.source === 'time' && e.target === 'offset' && e.targetHandle === 'b')).toBe(true)
  // past the guard that keeps a handled key's own cut event from running twice
  await select('lift').then(settle)
  document.dispatchEvent(new ClipboardEvent('cut', { bubbles: true, cancelable: true }))
  await expect.poll(() => [flow.findNode('lift'), linked('bass', 'mix')]).toEqual([undefined, true])
})

it('F links the selected nodes left to right through a free socket', async () => {
  await select('uv', 'speed')
  press('F')
  await expect.poll(() => linked('uv', 'speed')).toBe(true)
  expect(flow.edges.value.find((e) => e.source === 'uv' && e.target === 'speed')!.targetHandle).toBe('b')
})

it('Cmd+I selects every node that was not selected', async () => {
  await select('mix')
  press('Mod+I')
  await expect.poll(() => selected().length).toBe(defaults.nodes.length - 1)
  expect(selected()).not.toContain('mix')
})

it('L adds the nodes one link upstream, Shift+L the ones one link downstream', async () => {
  await select('mix')
  press('L')
  await expect.poll(selected).toEqual(['lift', 'mix', 'rainbow'])
  await select('mix')
  press('Shift+L')
  await expect.poll(selected).toEqual(['mix', 'out'])
})

it('Numpad . frames the selection, and with NumLock off it deletes nothing', async () => {
  await select('out')
  const before = { ...flow.viewport.value }
  press('NumpadDecimal')
  await expect.poll(() => flow.viewport.value).not.toEqual(before)
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', code: 'NumpadDecimal', bubbles: true, cancelable: true }))
  await settle()
  expect(flow.findNode('out')).toBeDefined()
})

it('F2 edits the title of the selected node: Enter keeps it, Escape leaves it as it was', async () => {
  await select('lift')
  press('F2')
  await expect.poll(() => nodeEl('lift').querySelector('.nui-rename')).not.toBeNull()
  const input = nodeEl('lift').querySelector<HTMLInputElement>('.nui-rename')!
  expect(document.activeElement).toBe(input)
  input.value = 'Kick lift'
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await expect.poll(() => nodeEl('lift').querySelector('.nui-title')?.textContent).toBe('Kick lift')
  expect(data('lift').label).toBe('Kick lift')
  press('F2')
  await expect.poll(() => nodeEl('lift').querySelector('.nui-rename')).not.toBeNull()
  const again = nodeEl('lift').querySelector<HTMLInputElement>('.nui-rename')!
  again.value = 'Other'
  press('Escape', again)
  await expect.poll(() => nodeEl('lift').querySelector('.nui-rename')).toBeNull()
  expect(data('lift').label).toBe('Kick lift')
})

it('Cmd+F finds a node by title, then shows and selects it', async () => {
  press('Mod+F')
  await expect.poll(() => document.querySelector('.node-find')).not.toBeNull()
  const filter = document.querySelector<HTMLInputElement>('.node-find input')!
  filter.value = 'output'
  filter.dispatchEvent(new Event('input', { bubbles: true }))
  await expect.poll(() => document.querySelectorAll('.node-find [data-node]').length).toBe(1)
  document.querySelector<HTMLElement>('.node-find [data-node="out"]')!.click()
  await expect.poll(() => document.querySelector('.node-find')).toBeNull()
  expect(selected()).toEqual(['out'])
})

it('N shows and hides the side panel in a graph', async () => {
  const shown = workspace.dockVisible
  expect([press('N').defaultPrevented, workspace.dockVisible]).toEqual([true, !shown])
})

it('Ctrl+Space hides every panel around the editor and brings them back', async () => {
  Object.assign(workspace, { dockVisible: true, bottomVisible: true, stripVisible: true })
  press('Ctrl+Space')
  expect([workspace.dockVisible, workspace.bottomVisible, workspace.stripVisible]).toEqual([false, false, false])
  press('Ctrl+Space')
  expect([workspace.dockVisible, workspace.bottomVisible, workspace.stripVisible]).toEqual([true, true, true])
})
