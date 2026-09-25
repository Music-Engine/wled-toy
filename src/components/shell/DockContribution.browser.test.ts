import { afterEach, expect, it } from 'vitest'
import { KeepAlive, createApp, defineComponent, h, markRaw, nextTick, type Component } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import DockContribution from './DockContribution.vue'
import GraphNode from '@/components/graph/GraphNode.vue'
import ParametersPanel from '@/components/graph/ParametersPanel.vue'
import DockTabs from './DockTabs.vue'
import ProblemsList from '@/features/graph-editor/problems/ProblemsList.vue'
import { useEngine } from '@/lib/engine/engine'
import type { GraphNodeData } from '@/lib/graph'
import { graph, node } from '@/lib/graph/testing'
import { dockHost, moveTab, resetLayout, selectTab, workspace, type Mode, type Problem, type TabId } from '@/lib/app/workspace'

let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  resetLayout()
  workspace.mode = 'shader'
})

const page = (name: string, tabs: TabId[], problems: Problem[]) => defineComponent({
  name,
  render: () => h('div', { class: `page-${name}` }, tabs.map((tab) =>
    h(DockContribution, { tab }, () => [
      h('input', { class: `from-${name}`, 'data-tab': tab }),
      tab === 'problems' ? h(ProblemsList, { problems }) : null,
    ]))),
})

const pages: Record<Mode, Component> = {
  shader: page('shader', ['problems'], [{ message: 'one' }]),
  graph: page('graph', ['problems', 'parameters', 'glsl'], [{ message: 'one', nodeId: 'a' }, { message: 'two' }, { message: 'three' }]),
  reference: page('reference', [], []),
}

function mount() {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () => h('div', [
      h('main', h(KeepAlive, () => h(pages[workspace.mode]))),
      h(DockTabs, { dock: 'right' }),
      h(DockTabs, { dock: 'bottom' }),
    ]),
  })
  // Nuxt UI is not installed here: UContextMenu renders as an unknown element that still shows its default slot
  app.config.warnHandler = () => undefined
  app.mount(root)
  unmount = () => { app.unmount(); root.remove() }
  return root
}

async function go(mode: Mode) {
  workspace.mode = mode
  await nextTick()
  await nextTick()
}

const contributed = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.dock-tabs input')].map((el) => `${el.className}:${el.dataset.tab}`).sort()

it('a kept-alive page takes its dock contributions with it when another mode is shown', async () => {
  const root = mount()
  await go('shader')
  expect(contributed(root)).toEqual(['from-shader:problems'])

  await go('graph')
  expect(contributed(root)).toEqual(['from-graph:glsl', 'from-graph:parameters', 'from-graph:problems'])

  await go('reference')
  expect(contributed(root)).toEqual([])

  await go('graph')
  expect(contributed(root)).toEqual(['from-graph:glsl', 'from-graph:parameters', 'from-graph:problems'])
  expect(root.querySelector('main')!.querySelectorAll('input').length).toBe(0)
})

it('a contribution keeps its state while its page is inactive', async () => {
  const root = mount()
  await go('graph')
  const input = dockHost('parameters').querySelector('input')!
  input.value = 'typed'
  await go('shader')
  await go('graph')
  expect(dockHost('parameters').querySelector('input')).toBe(input)
  expect(input.value).toBe('typed')
  expect(root.querySelector('[data-dock="right"]')!.contains(input)).toBe(true)
})

it('moving a tab to the other dock moves the same live content, and the tab strip follows', async () => {
  const root = mount()
  await go('graph')
  const right = root.querySelector<HTMLElement>('[data-dock="right"]')!
  const bottom = root.querySelector<HTMLElement>('[data-dock="bottom"]')!
  const input = dockHost('parameters').querySelector('input')!
  input.value = 'typed'
  expect(right.contains(input)).toBe(true)

  moveTab('parameters', 'bottom')
  await nextTick()
  expect(bottom.contains(input)).toBe(true)
  expect(right.contains(input)).toBe(false)
  expect(input.value).toBe('typed')
  expect([...bottom.querySelectorAll('[role="tab"]')].map((el) => el.getAttribute('data-tab'))).toContain('parameters')
  expect(right.querySelector('[data-tab="parameters"]')).toBeNull()
  expect(bottom.querySelector('[data-tab="parameters"]')!.getAttribute('aria-selected')).toBe('true')
  expect(input.checkVisibility()).toBe(true)
})

it('only the selected tab of a dock is displayed, and the hidden ones stay mounted', async () => {
  const root = mount()
  await go('graph')
  const problems = dockHost('problems').querySelector('input')!
  const glsl = dockHost('glsl').querySelector('input')!
  expect(problems.checkVisibility()).toBe(true)
  expect(glsl.checkVisibility()).toBe(false)
  root.querySelector<HTMLElement>('[data-tab="glsl"]')!.click()
  await nextTick()
  expect(problems.checkVisibility()).toBe(false)
  expect(problems.isConnected).toBe(true)
  expect(glsl.checkVisibility()).toBe(true)
})

it('the Problems tab counts the problems of the mode on screen, and nothing in Reference', async () => {
  const root = mount()
  const count = () => root.querySelector('[data-tab="problems"] span')?.textContent
  await go('shader')
  expect(count()).toBe('1')
  await go('graph')
  expect(count()).toBe('3')
  expect(root.querySelectorAll('.dock-tabs .problems-list').length).toBe(1)
  await go('shader')
  expect(count()).toBe('1')
  await go('reference')
  expect(workspace.problemCount).toBe(0)
})

it('a bound MIDI controller still moves its knob while the Parameters tab is hidden behind another tab in a collapsed dock', async () => {
  workspace.mode = 'graph'
  const doc = graph([node('a', 'knob', { label: 'Speed', value: 0.5, min: 0, max: 2, cc: 74 })])
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () => [
      h('div', { style: 'height: 300px' }, h(VueFlow, { id: 'dock-test-flow', nodes: doc.nodes, nodeTypes: { shader: markRaw(GraphNode) } })),
      h(DockContribution, { tab: 'parameters' }, () => h(ParametersPanel, { flowId: 'dock-test-flow', scenes: [] })),
      // v-show is how the shell collapses a dock
      h('div', { style: 'display: none' }, h(DockTabs, { dock: 'right' })),
    ],
  })
  app.config.warnHandler = () => undefined
  app.mount(root)
  unmount = () => { app.unmount(); root.remove() }
  moveTab('log', 'right')
  selectTab('log')
  await new Promise((resolve) => setTimeout(resolve, 100))

  const panel = dockHost('parameters').querySelector<HTMLElement>('.nui-parameters')!
  expect(panel.isConnected).toBe(true)
  expect(panel.checkVisibility()).toBe(false)
  useEngine().midi.receive(Uint8Array.of(0xb0, 74, 127))
  await nextTick()
  expect((useVueFlow('dock-test-flow').findNode('a')!.data as GraphNodeData).values.value).toBe(2)
})
