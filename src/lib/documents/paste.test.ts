import { expect, it } from 'vitest'
import { newNodeData } from '@/lib/graph'
import { remapPasted } from './paste'

const nodes = [
  { id: 'a', position: { x: 10, y: 20 }, data: newNodeData('math', { b: 1 }) },
  { id: 'b', position: { x: 30, y: 40 }, data: newNodeData('time') },
]
const edges = [{ id: 'e1', source: 'b', sourceHandle: 'time', target: 'a', targetHandle: 'a', style: { stroke: '#fff' } }]

it('gives the copies fresh ids and points the copied links at them', () => {
  const pasted = remapPasted(nodes, edges)
  const [a, b] = pasted.nodes
  expect(a.id).toMatch(/^math-\w+-0$/)
  expect(b.id).toMatch(/^time-\w+-1$/)
  expect(pasted.edges).toEqual([{ id: expect.stringMatching(/^e-\w+-0$/), source: b.id, sourceHandle: 'time', target: a.id, targetHandle: 'a', style: { stroke: '#fff' } }])
})

it('keeps positions and deep-copies the data', () => {
  const pasted = remapPasted(nodes, edges)
  expect(pasted.nodes.map((n) => n.position)).toEqual(nodes.map((n) => n.position))
  expect(pasted.nodes[0].data).toEqual(nodes[0].data)
  expect(pasted.nodes[0].data.values).not.toBe(nodes[0].data.values)
})

it('never repeats an id across two pastes of the same nodes', () => {
  const first = remapPasted(nodes, edges)
  const second = remapPasted(nodes, edges)
  const ids = [...first.nodes, ...second.nodes].map((n) => n.id)
  expect(new Set(ids).size).toBe(ids.length)
  expect(first.edges[0].id).not.toBe(second.edges[0].id)
})
