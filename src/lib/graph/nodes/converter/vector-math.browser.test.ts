import { describe, expect, it } from 'vitest'
import { graph, node, renderGraph, toByte } from '@/lib/graph/testing'
import { VECTOR_OPS, vectorMathNode, type VectorOpName } from './vector-math'

/** One LED through the usermod unit: vector as a color, number as grey */
async function compute(op: VectorOpName, values: Record<string, unknown>): Promise<number[]> {
  const output = VECTOR_OPS[op].out === 'vector' ? 'vector' : 'value'
  const { leds, issues } = await renderGraph(graph([node('v', 'vectorMath', { op, ...values } as never), node('o', 'output')], [[`v.${output}`, 'o.color']]), {
    leds: 1,
  })
  expect(issues).toEqual([])
  return leds[0]
}

describe('Vector Math', () => {
  it('shapes its sockets by operation', () => {
    const listNames = (op: VectorOpName) =>
      vectorMathNode
        .shape({ op })
        .inputs.filter((socket) => socket.linkable)
        .map((socket) => socket.name)
    expect(listNames('length')).toEqual(['a'])
    expect(listNames('scale')).toEqual(['a', 'scale'])
    expect(listNames('wrap')).toEqual(['a', 'b', 'c'])
    expect(vectorMathNode.shape({ op: 'dot' }).outputs.map((output) => output.name)).toEqual(['value'])
  })

  it.each(Object.keys(VECTOR_OPS) as VectorOpName[])("%s agrees with its op table's JavaScript reference", async (op) => {
    const operation = VECTOR_OPS[op]
    const a: [number, number, number] = [0.3, 0.6, 0.9]
    const b: [number, number, number] = [0.5, 0.25, 0.75]
    const c: [number, number, number] = [0.2, 0.9, 0.4]
    const expected = operation.js(a, b, c, 0.5)
    const actual = await compute(op, { a, b, c, scale: 0.5 })
    const want = Array.isArray(expected) ? expected.map(toByte) : [toByte(expected), toByte(expected), toByte(expected)]
    actual.forEach((channel, k) => expect(Math.abs(channel - want[k]), `${op}: C++ ${actual} vs js ${want}`).toBeLessThanOrEqual(1))
  })

  it('a number linked in spreads over the vector', async () => {
    const { leds } = await renderGraph(
      graph(
        [node('k', 'value', { value: 0.25 }), node('v', 'vectorMath', { op: 'add', a: [0.5, 0.25, 0] }), node('o', 'output')],
        [
          ['k.value', 'v.b'],
          ['v.vector', 'o.color'],
        ],
      ),
      { leds: 1 },
    )
    expect(leds[0]).toEqual([191, 128, 64])
  })

  it('Combine XYZ and Separate XYZ round trip', async () => {
    const { leds } = await renderGraph(
      graph(
        [node('c', 'combineXYZ', { x: 0.2, y: 0.4, z: 0.6 }), node('s', 'separateXYZ'), node('o', 'output')],
        [
          ['c.vector', 's.vector'],
          ['s.z', 'o.color'],
        ],
      ),
      { leds: 1 },
    )
    expect(leds[0]).toEqual([153, 153, 153])
  })
})
