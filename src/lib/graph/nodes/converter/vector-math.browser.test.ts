import { describe, expect, it } from 'vitest'
import { graph, node, renderGraph } from '@/lib/graph/testing'
import { VECTOR_OPS, vectorMathNode, type VectorOpName } from './vector-math'

const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255)

/** One LED: a vector result shows as a color, a number as grey. */
function compute(op: VectorOpName, values: Record<string, unknown>) {
  const def = VECTOR_OPS[op]
  const output = def.out === 'vector' ? 'vector' : 'value'
  const { leds, compileError, shader } = renderGraph(graph([node('v', 'vectorMath', { op, ...values } as never), node('o', 'output')], [[`v.${output}`, 'o.color']]), { leds: 1 })
  expect(compileError, shader.code).toBeNull()
  return leds[0]
}

describe('Vector Math', () => {
  it('shapes its sockets by operation', () => {
    const names = (op: VectorOpName) => vectorMathNode.shape({ op }).inputs.filter((s) => s.linkable).map((s) => s.name)
    expect(names('length')).toEqual(['a'])
    expect(names('scale')).toEqual(['a', 'scale'])
    expect(names('wrap')).toEqual(['a', 'b', 'c'])
    expect(vectorMathNode.shape({ op: 'dot' }).outputs.map((o) => o.name)).toEqual(['value'])
  })

  it.each(Object.keys(VECTOR_OPS) as VectorOpName[])('%s agrees between the shader and the CPU', (op) => {
    const def = VECTOR_OPS[op]
    const a: [number, number, number] = [0.3, 0.6, 0.9]
    const b: [number, number, number] = [0.5, 0.25, 0.75]
    const c: [number, number, number] = [0.2, 0.9, 0.4]
    const expected = def.js(a, b, c, 0.5)
    const actual = compute(op, { a, b, c, scale: 0.5 })
    const want = Array.isArray(expected) ? expected.map(byte) : [byte(expected), byte(expected), byte(expected)]
    actual.forEach((channel, k) => expect(Math.abs(channel - want[k]), `${op}: shader ${actual} vs js ${want}`).toBeLessThanOrEqual(1))
  })

  it('a number linked in spreads over the vector', () => {
    const { leds } = renderGraph(graph([node('k', 'value', { value: 0.25 }), node('v', 'vectorMath', { op: 'add', a: [0.5, 0.25, 0] }), node('o', 'output')], [['k.value', 'v.b'], ['v.vector', 'o.color']]), { leds: 1 })
    expect(leds[0]).toEqual([191, 128, 64])
  })

  it('Combine XYZ and Separate XYZ round trip, on both sides', () => {
    const { leds } = renderGraph(graph([node('c', 'combineXYZ', { x: 0.2, y: 0.4, z: 0.6 }), node('s', 'separateXYZ'), node('o', 'output')], [['c.vector', 's.vector'], ['s.z', 'o.color']]), { leds: 1 })
    expect(leds[0]).toEqual([153, 153, 153])
    expect(vectorMathNode.base.run).toBeDefined()
  })
})
