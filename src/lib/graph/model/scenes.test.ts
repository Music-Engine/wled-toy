import { describe, expect, it } from 'vitest'
import { captureScene, fadeScene, parseScenes, pruneScenes, type Scene } from './scenes'
import { node } from '@/lib/graph/testing'

const scene: Scene = { id: 's', name: 'Drop', values: { a: 1, b: 0.3 } }

describe('fadeScene', () => {
  it('moves every knob linearly and lands exactly on the scene', () => {
    const from = { a: 0, b: 0.9 }
    expect(fadeScene(from, scene, 0)).toEqual(from)
    expect(fadeScene(from, scene, 0.5)).toEqual({ a: 0.5, b: 0.6 })
    expect(fadeScene({ a: 0.1, b: 0.7 }, scene, 1)).toEqual({ a: 1, b: 0.3 })
    expect(fadeScene(from, scene, 7)).toEqual({ a: 1, b: 0.3 })
  })

  it('leaves knobs alone that the scene was saved without', () => {
    expect(fadeScene({ a: 0, added: 0.42 }, scene, 1)).toEqual({ a: 1, added: 0.42 })
  })
})

describe('scenes and the graph', () => {
  const nodes = [node('a', 'knob', { value: 0.8 }), node('b', 'knob'), node('m', 'math')]

  it('captures knobs only, with their default when untouched', () => {
    expect(captureScene(nodes, 'Intro')).toMatchObject({ name: 'Intro', values: { a: 0.8, b: 0.5 } })
  })

  it('forgets a deleted knob in every scene', () => {
    expect(pruneScenes([scene, { ...scene, id: 't' }], [nodes[0]]).map((s) => s.values)).toEqual([{ a: 1 }, { a: 1 }])
  })

  it('loads what is valid from stored scenes and ignores the rest', () => {
    expect(parseScenes([scene, null, { id: 'x' }, { id: 'y', name: 'Y', values: { a: 'loud', b: 2 } }])).toEqual([
      scene,
      { id: 'y', name: 'Y', values: { b: 2 } },
    ])
    expect(parseScenes('nope')).toEqual([])
  })
})
