import { describe, expect, it } from 'vitest'
import { createDefaultGraph, type NodeGraph } from '@/lib/graph'
import { compileKey } from './compile-key'

const key = (doc: NodeGraph) => compileKey(doc.nodes, doc.edges)

function edited(edit: (doc: NodeGraph) => void): NodeGraph {
  const doc = createDefaultGraph()
  edit(doc)
  return doc
}

describe('compileKey', () => {
  const base = key(createDefaultGraph())

  it('ignores what the compiler does not read', () => {
    expect(key(edited((doc) => {
      for (const n of doc.nodes) n.position = { x: n.position.x + 40, y: n.position.y - 7 }
      doc.nodes[0].data.collapsed = true
      doc.nodes[0].data.hideUnused = true
      doc.nodes[0].data.label = 'Renamed'
      doc.edges[0].style = { stroke: '#fff' }
      doc.edges[0].id = 'renamed'
    }))).toBe(base)
  })

  it('changes with a value', () => {
    expect(key(edited((doc) => (doc.nodes.find((n) => n.id === 'speed')!.data.values.b = 0.3)))).not.toBe(base)
  })

  it('ignores a Knob\'s value, which reaches the program as a uniform, but not its range', () => {
    const withKnobValues = (values: Record<string, number>) => edited((doc) => doc.nodes.push({ id: 'k', type: 'shader', position: { x: 0, y: 0 }, data: { kind: 'knob', values } }))
    expect(key(withKnobValues({ value: 0.9 }))).toBe(key(withKnobValues({ value: 0.1 })))
    expect(key(withKnobValues({ value: 0.1, max: 2 }))).not.toBe(key(withKnobValues({ value: 0.1 })))
  })

  it('changes with a kind', () => {
    expect(key(edited((doc) => (doc.nodes.find((n) => n.id === 'bass')!.data.kind = 'knob')))).not.toBe(base)
  })

  it('changes with an edge', () => {
    expect(key(edited((doc) => (doc.edges[0].targetHandle = 'b')))).not.toBe(base)
    expect(key(edited((doc) => doc.edges.pop()))).not.toBe(base)
  })

  it('changes with an output setting', () => {
    expect(key(edited((doc) => (doc.nodes.find((n) => n.id === 'out')!.data.values.gamma = 1.8)))).not.toBe(base)
  })

  it('changes with a mute', () => {
    expect(key(edited((doc) => (doc.nodes.find((n) => n.id === 'lift')!.data.muted = true)))).not.toBe(base)
  })
})
