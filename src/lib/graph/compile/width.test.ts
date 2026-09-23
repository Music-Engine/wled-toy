import { describe, expect, it } from 'vitest'
import { generateGlsl } from '@/lib/graph'
import type { NodeGraph } from '@/lib/graph/model/doc'
import { graph, node } from '@/lib/graph/testing'
import { Compilation, type CompileOptions } from './compilation'
import { placeNodes } from './placement'
import { inferWidths } from './width'

function widths(doc: NodeGraph, options: CompileOptions = {}) {
  const c = new Compilation(doc, options)
  placeNodes(c, ['o'])
  inferWidths(c, ['o'])
  return Object.fromEntries(c.widths)
}

describe('inferWidths', () => {
  it('keeps a chain of scalars scalar', () => {
    const doc = graph([node('a', 'math'), node('b', 'math'), node('o', 'output')], [['a.result', 'b.a'], ['b.result', 'o.color']])
    expect(widths(doc)).toMatchObject({ a: 'float', b: 'float' })
  })

  it('widens every generic node downstream of a vec3', () => {
    const doc = graph([node('c', 'color'), node('a', 'math'), node('b', 'math'), node('o', 'output')], [['c.color', 'a.a'], ['a.result', 'b.b'], ['b.result', 'o.color']])
    expect(widths(doc)).toMatchObject({ a: 'vec3', b: 'vec3' })
  })

  it('takes the wider side where two paths from one source meet', () => {
    const doc = graph(
      [node('t', 'vector2'), node('c', 'color'), node('l', 'math'), node('r', 'math'), node('j', 'math'), node('o', 'output')],
      [['t.vector', 'l.a'], ['t.vector', 'r.a'], ['c.color', 'r.b'], ['l.result', 'j.a'], ['r.result', 'j.b'], ['j.result', 'o.color']],
    )
    expect(widths(doc)).toMatchObject({ l: 'vec2', r: 'vec3', j: 'vec3' })
  })

  it('reads an unlinked generic node from what it stores', () => {
    const doc = (values: Record<string, number | number[]>) => graph([node('m', 'math', values), node('o', 'output')], [['m.result', 'o.color']])
    expect(widths(doc({}))).toMatchObject({ m: 'float' })
    expect(widths(doc({ b: [0.1, 0.2] }))).toMatchObject({ m: 'vec2' })
  })

  it('gives a per-frame node its width, and planning derives its dims from it', () => {
    const doc = graph([node('k', 'knob'), node('m', 'math', { b: [0.2, 0.4, 0.6] }), node('o', 'output')], [['k.value', 'm.a'], ['m.result', 'o.color']])
    expect(widths(doc)).toMatchObject({ k: 'float', m: 'vec3' })
    const { control } = generateGlsl(doc)
    expect(control.steps.find((step) => step.nodeId === 'm')?.dims).toEqual({ a: 3, b: 3 })
    expect(control.exports).toEqual([{ step: 1, output: 'result', slot: 0, dim: 3 }])
  })

  it('standalone, reads a frozen per-frame output as the literal of its last value', () => {
    const doc = graph([node('k', 'knob'), node('m', 'math'), node('o', 'output')], [['k.value', 'm.a'], ['m.result', 'o.color']])
    const standalone = { standalone: true, controls: () => [0.1, 0.2] }
    expect(widths(doc, standalone)).toMatchObject({ m: 'vec2' })
    expect(widths(doc, standalone)).not.toHaveProperty('k')
  })
})
