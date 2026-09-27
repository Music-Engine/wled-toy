import { afterEach, expect, it } from 'vitest'
import { createApp, h, markRaw, nextTick, ref } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import GraphNode from '@/features/node-ui/GraphNode.vue'
import ParametersPanel from './ParametersPanel.vue'
import { useEngine } from '@/lib/engine/engine'
import type { GraphNodeData, Scene } from '@/lib/graph'
import { graph, node } from '@/lib/graph/testing'
import { dragBy } from '@/test/pointer'

let unmount: (() => void) | undefined
afterEach(() => unmount?.())

const settle = () => new Promise((resolve) => setTimeout(resolve, 100))

function mount() {
  const doc = graph([node('a', 'knob', { label: 'Speed', value: 0.5, min: 0, max: 2, cc: 74 }), node('b', 'knob', { label: 'Hue' }), node('v', 'value')])
  const scenes = ref<Scene[]>([])
  const root = document.createElement('div')
  root.style.cssText = 'width: 900px'
  document.body.append(root)
  const app = createApp({
    render: () => [
      h('div', { style: 'height: 300px' }, h(VueFlow, { id: 'test-flow', nodes: doc.nodes, nodeTypes: { shader: markRaw(GraphNode) } })),
      h('div', { style: 'width: 300px' }, h(ParametersPanel, { flowId: 'test-flow', scenes: scenes.value, 'onUpdate:scenes': (next: Scene[]) => (scenes.value = next) })),
    ],
  })
  // the panel's one Nuxt UI icon is decoration; unresolved, it renders as an unknown element and the test does not need it
  app.config.warnHandler = () => undefined
  app.mount(root)
  unmount = () => { app.unmount(); root.remove() }
  const values = (id: string) => (useVueFlow('test-flow').findNode(id)!.data as GraphNodeData).values
  return { root, values }
}

it('lists every Knob by its name, and nothing else', async () => {
  const { root } = mount()
  await settle()
  // the first section lists the knobs, one inspector row each, label on the left
  const labels = [...root.querySelectorAll('.nui-parameters .inspector-section:first-child .inspector-row > span')].map((el) => el.textContent)
  expect(labels).toEqual(['Speed', 'Hue'])
})

it('dragging a parameter writes the knob node, within the knob range', async () => {
  const { root, values } = mount()
  await settle()
  const field = root.querySelector('.nui-parameters .nui-range-text')!
  await dragBy(field, 1000)
  expect(values('a').value).toBe(2)
})

it('a change on the node shows in the panel', async () => {
  const { root, values } = mount()
  await settle()
  useVueFlow('test-flow').updateNodeData('b', { values: { ...values('b'), value: 0.125 } })
  await nextTick()
  expect(root.querySelectorAll('.nui-parameters .nui-range-value')[1].textContent).toBe('0.125')
})

it('a bound MIDI controller moves its knob across the knob range', async () => {
  const { values } = mount()
  await settle()
  useEngine().midi.receive(Uint8Array.of(0xb0, 74, 127))
  await nextTick()
  expect(values('a').value).toBe(2)
  expect(values('b').value).toBeUndefined()
})

it('saves the knobs as a scene and recalls it, exactly, after they were moved', async () => {
  const { root, values } = mount()
  await settle()
  const button = (label: string) => [...root.querySelectorAll<HTMLButtonElement>('.nui-parameters .inspector-section:last-child button')].find((b) => b.textContent?.trim() === label)!
  button('Save Scene').click()
  await nextTick()
  const flow = useVueFlow('test-flow')
  flow.updateNodeData('a', { values: { ...values('a'), value: 1.75 } })
  flow.updateNodeData('b', { values: { ...values('b'), value: 0.9 } })
  await nextTick()

  // the fade field defaults to half a second
  button('0').click()
  // part way through the fade the knob is between where it was and where the scene has it
  const seen: number[] = []
  const deadline = performance.now() + 3000
  while (values('a').value !== 0.5 && performance.now() < deadline) {
    seen.push(values('a').value as number)
    await new Promise((resolve) => setTimeout(resolve, 30))
  }
  expect(seen.some((v) => v > 0.5 && v < 1.75)).toBe(true)
  expect(values('a').value).toBe(0.5)
  expect(values('b').value).toBe(0.5)
})
