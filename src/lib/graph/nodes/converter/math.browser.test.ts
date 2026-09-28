import { describe, expect, it } from 'vitest'
import { GRAPH_FS } from '@/lib/graph'
import { flattenFs } from '@/lib/shader/menu-fs'
import { graph, node, renderGraph, toByte } from '@/lib/graph/testing'
import { MATH_OPS, mathNode, type MathOpName } from './math'

/** One LED through the usermod unit, result as a byte */
async function compute(op: MathOpName, values: Record<string, number>): Promise<number> {
  const { leds, issues } = await renderGraph(graph([node('m', 'math', { op, ...values }), node('o', 'output')], [['m.result', 'o.color']]), { leds: 1 })
  expect(issues).toEqual([])
  return leds[0][0]
}

describe('Math', () => {
  it('takes the sockets its operation needs, with their names', () => {
    const listLabels = (op: MathOpName) => mathNode.shape({ op }).inputs.filter((socket) => socket.linkable).map((socket) => socket.label)
    expect(listLabels('sine')).toEqual(['Value'])
    expect(listLabels('power')).toEqual(['Base', 'Exponent'])
    expect(listLabels('wrap')).toEqual(['Value', 'Min', 'Max'])
    expect(mathNode.base.inputs.map((socket) => socket.name)).toEqual(['op', 'clamp', 'a', 'b'])
  })

  it.each(Object.keys(MATH_OPS) as MathOpName[])('%s agrees with its op table\'s JavaScript reference', async (op) => {
    const operation = MATH_OPS[op]
    for (const [a, b, c] of [[0.3, 0.7, 0.2], [0.9, 0.25, 0.5], [0.5, 0, 0.1]]) {
      const expected = operation.js(a, b, c)
      const actual = await compute(op, { a, b, c })
      // Both sides clamp to 0..1 on the way to a byte
      expect(Math.abs(actual - toByte(expected)), `${op}(${a}, ${b}, ${c}) C++ ${actual} vs js ${toByte(expected)}`).toBeLessThanOrEqual(1)
    }
  }, 30_000)

  it('handles the cases Blender guards: dividing by zero, a negative base, log of a bad base', async () => {
    expect(await compute('divide', { a: 1, b: 0 })).toBe(0)
    expect(MATH_OPS.power.js(-2, 3)).toBe(-8)
    expect(await compute('power', { a: -0.5, b: 2 })).toBe(64)
    expect(await compute('power', { a: -0.5, b: 0.5 })).toBe(0)
    expect(await compute('logarithm', { a: 8, b: 1 })).toBe(0)
    expect(MATH_OPS.modulo.js(-1.5, 1)).toBe(-0.5)
    expect(MATH_OPS.flooredModulo.js(-1.5, 1)).toBe(0.5)
  }, 30_000)

  it('goes through vectors per component', async () => {
    const { leds } = await renderGraph(graph([node('c', 'color', { color: [0.24, 0.5, 0.8] }), node('m', 'math', { op: 'multiply', b: 0.5 }), node('o', 'output')], [['c.color', 'm.a'], ['m.result', 'o.color']]), { leds: 1 })
    expect(leds[0]).toEqual([31, 64, 102])
  })

  it('every operation is in the add menu under its own name', () => {
    const presets = flattenFs(GRAPH_FS.items).filter((row) => row.preset && row.path.includes('Math Operations'))
    expect(presets.map((row) => row.preset!.title)).toEqual(expect.arrayContaining(['Sine', 'Ping-Pong', 'Arctan2', 'Multiply Add']))
    expect(presets.every((row) => row.node === mathNode)).toBe(true)
    expect(presets).toHaveLength(Object.keys(MATH_OPS).length)
  })
})
