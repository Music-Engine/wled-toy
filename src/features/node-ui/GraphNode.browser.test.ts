import { afterEach, expect, it } from 'vitest'
import { createApp, h, markRaw, nextTick } from 'vue'
import { VueFlow } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import GraphNode from './GraphNode.vue'
import { graph, node } from '@/lib/graph/testing'

let unmount: (() => void) | undefined
afterEach(() => unmount?.())

const settle = () => new Promise((resolve) => setTimeout(resolve, 150))

it('a collapsed node hides its rows and keeps its links attached', async () => {
  const doc = graph([node('value', 'value'), node('math', 'math')], [['value.value', 'math.a']])
  doc.nodes[1].position = { x: 320, y: 0 }
  const root = document.createElement('div')
  root.style.cssText = 'width: 900px; height: 500px'
  document.body.append(root)
  const app = createApp({ render: () => h(VueFlow, { nodes: doc.nodes, edges: doc.edges, nodeTypes: { shader: markRaw(GraphNode) } }) })
  app.mount(root)
  unmount = () => {
    app.unmount()
    root.remove()
  }
  await settle()

  const math = root.querySelector<HTMLElement>('[data-id="math"]')!
  const edgePath = () => root.querySelector('.vue-flow__edge path')?.getAttribute('d')
  const expanded = edgePath()
  expect(expanded).toBeTruthy()
  expect(math.querySelectorAll('.nui-row').length).toBeGreaterThan(2)

  math.querySelector<HTMLElement>('.nui-collapse')!.click()
  await nextTick()
  await settle()

  expect(math.querySelectorAll('.nui-row')).toHaveLength(0)
  expect(math.querySelector('[data-handleid="a"]')).not.toBeNull()
  expect(edgePath()).toBeTruthy()
  expect(edgePath(), 'the link follows the socket up to the header').not.toBe(expanded)

  const header = math.querySelector('.nui-header')!.getBoundingClientRect()
  const inputs = [...math.querySelectorAll('.vue-flow__handle-left')].map((el) => el.getBoundingClientRect())
  expect(inputs.length).toBeGreaterThan(1)
  inputs.forEach((socket, i) => {
    expect(socket.top, 'a folded socket stays inside the header').toBeGreaterThanOrEqual(header.top)
    expect(socket.bottom).toBeLessThanOrEqual(header.bottom)
    expect(Math.abs(socket.left + socket.width / 2 - header.left), 'a folded input sits on the left edge').toBeLessThan(1.5)
    if (i > 0) expect(socket.top, 'folded sockets do not overlap').toBeGreaterThanOrEqual(inputs[i - 1].bottom)
  })
})
