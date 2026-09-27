import { describe, expect, it } from 'vitest'
import { GRAPH_FS, canCast, createDefaultGraph, firstCompatibleSocket } from '@/lib/graph'
import { Color } from '@/lib/graph/define/socket-types'
import { flattenFs } from '@/lib/shader/menu-fs'
import { graph, link, node, renderGraph } from '@/lib/graph/testing'

describe('default graph', () => {
  it('compiles and renders the rainbow at time 0', () => {
    const { compileError, shader, leds } = renderGraph(createDefaultGraph())
    expect(shader.error).toBeNull()
    expect(compileError).toBeNull()
    expect(leds).toMatchSnapshot()
  })
})

describe('constants reach the LEDs', () => {
  it('Color -> Output', () => {
    const { leds } = renderGraph(graph([node('c', 'color', { color: [1, 0.5, 0] }), node('o', 'output')], [['c.color', 'o.color']]), { leds: 3 })
    expect(leds).toEqual([[255, 128, 0], [255, 128, 0], [255, 128, 0]])
  })

  it('UV.x -> Output spreads a float across all channels along the strip', () => {
    const { leds } = renderGraph(graph([node('uv', 'uv'), node('o', 'output')], [['uv.x', 'o.color']]), { leds: 4 })
    expect(leds.map(([r]) => r)).toEqual([32, 96, 159, 223])
    expect(leds.every(([r, g, b]) => r === g && g === b)).toBe(true)
  })
})

describe('every node in the menu', () => {
  const items = flattenFs(GRAPH_FS.items).map((row) => row.node).filter((item) => !item.base.isOutput)

  it.each(items.map((item) => [item.id, item] as const))('%s compiles, twice in one graph', (_, item) => {
    const out = item.base.outputs[0]
    // a stream output (Audio, Spectrum) cannot color an LED; such a node is still compiled, as a sink would be
    const drawable = out && canCast(out.type, Color)
    const doc = graph([node('a', item.id), node('b', item.id), node('o', 'output')], drawable ? [[`a.${out.name}`, 'o.color']] : [])
    // the second instance is only evaluated when something reads it, so feed it into the first where the types allow
    const feedback = out && firstCompatibleSocket(item.base, out.type, 'in')
    if (feedback) doc.edges.push(link(`b.${out.name}`, `a.${feedback.name}`))
    const { shader, compileError } = renderGraph(doc)
    expect(compileError, shader.code).toBeNull()
  })
})

describe('links the editor would refuse', () => {
  it('a vector into a sampler socket is a graph error, not a GLSL error', () => {
    const { shader } = renderGraph(graph([node('c', 'color'), node('t', 'texture'), node('o', 'output')], [['c.color', 't.texture'], ['t.out', 'o.color']]))
    expect(shader.errorNode).toBe('t')
    expect(shader.error).toMatch(/Cannot cast vec3 to sampler2D/)
  })
})
