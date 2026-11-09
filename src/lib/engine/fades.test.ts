import { beforeEach, expect, it } from 'vitest'
import type { Scene } from '@/lib/graph'
import { SceneFades } from './fades'

const scene = (values: Record<string, number>): Scene => ({ id: 'scene', name: 'Scene', values })
let fades: SceneFades
let writes: [string, number][]
const write = (id: string, value: number) => writes.push([id, value])

beforeEach(() => {
  fades = new SceneFades()
  writes = []
})

it('writes where the knobs start at once, knobs the scene does not know included', () => {
  fades.start({ a: 0, b: 1 }, scene({ a: 2 }), 1, write, 1000)
  expect(writes).toEqual([
    ['a', 0],
    ['b', 1],
  ])
})

it('writes the knobs part of the way as the clock advances', () => {
  fades.start({ a: 0 }, scene({ a: 2 }), 2, write, 1000)
  fades.advance(1500)
  fades.advance(2000)
  expect(writes).toEqual([
    ['a', 0],
    ['a', 0.5],
    ['a', 1],
  ])
})

it('ends on the scene exactly and then writes nothing more', () => {
  fades.start({ a: 0.1 }, scene({ a: 0.3 }), 0.5, write, 0)
  fades.advance(700)
  fades.advance(800)
  expect(writes).toEqual([
    ['a', 0.1],
    ['a', 0.3],
  ])
})

it('a zero-second fade lands on the scene at once', () => {
  fades.start({ a: 0 }, scene({ a: 2 }), 0, write, 0)
  fades.advance(16)
  expect(writes).toEqual([['a', 2]])
})

it('a new start takes over from the fade before it, which writes nothing more', () => {
  const first: [string, number][] = []
  fades.start({ a: 0 }, scene({ a: 1 }), 1, (id, value) => first.push([id, value]), 0)
  fades.advance(500)
  fades.start({ a: 0.5 }, scene({ a: 0 }), 1, write, 500)
  fades.advance(1000)
  expect(first).toEqual([
    ['a', 0],
    ['a', 0.5],
  ])
  expect(writes).toEqual([
    ['a', 0.5],
    ['a', 0.25],
  ])
})

it('advancing with no fade running writes nothing', () => {
  fades.advance(1000)
  expect(writes).toEqual([])
})

it('recalls the scene a followed Scene Switch probe asks for once per change, and nothing once it stops following', () => {
  const recalled: number[] = []
  let index: number | undefined
  const probes = { readProbe: (nodeId: string) => (nodeId === 'switch' ? index : undefined) }
  fades.followSwitch({ nodeId: 'switch', recall: (i) => recalled.push(i) })
  fades.readSwitch(probes)
  for (const next of [0, 0, 2, 2, 1]) {
    index = next
    fades.readSwitch(probes)
  }
  fades.followSwitch(null)
  index = 3
  fades.readSwitch(probes)
  expect(recalled).toEqual([0, 2, 1])
})
