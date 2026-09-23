import { describe, expect, it } from 'vitest'
import { GRAPH_FS } from '@/lib/graph'
import { flattenFs } from '@/lib/shader/menu-fs'
import { graph, node, renderGraph } from '@/lib/graph/testing'
import { MATH_OPS, mathNode, type MathOpName } from './math'

/** Math on one LED: `a`, `b`, `c` as stored values, the result as a byte. */
const compute = (op: MathOpName, values: Record<string, number>) => {
  const { leds, compileError, shader } = renderGraph(graph([node('m', 'math', { op, ...values }), node('o', 'output')], [['m.result', 'o.color']]), { leds: 1 })
  expect(compileError, shader.code).toBeNull()
  return leds[0][0]
}
const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255)

describe('Math', () => {
  it('takes the sockets its operation needs, with their names', () => {
    const labels = (op: MathOpName) => mathNode.shape({ op }).inputs.filter((s) => s.linkable).map((s) => s.label)
    expect(labels('sine')).toEqual(['Value'])
    expect(labels('power')).toEqual(['Base', 'Exponent'])
    expect(labels('wrap')).toEqual(['Value', 'Min', 'Max'])
    expect(mathNode.base.inputs.map((s) => s.name)).toEqual(['op', 'clamp', 'a', 'b'])
  })

  it.each(Object.keys(MATH_OPS) as MathOpName[])('%s agrees between the pixel and frame bodies', (op) => {
    const def = MATH_OPS[op]
    for (const [a, b, c] of [[0.3, 0.7, 0.2], [0.9, 0.25, 0.5], [0.5, 0, 0.1]]) {
      const expected = def.js(a, b, c)
      const actual = compute(op, { a, b, c })
      // both sides clamp to 0..1 on the way to a byte, so only that range is compared
      expect(Math.abs(actual - byte(expected)), `${op}(${a}, ${b}, ${c}) shader ${actual} vs js ${byte(expected)}`).toBeLessThanOrEqual(1)
    }
  })

  it('handles the cases Blender guards: dividing by zero, a negative base, log of a bad base', () => {
    expect(compute('divide', { a: 1, b: 0 })).toBe(0)
    expect(MATH_OPS.power.js(-2, 3)).toBe(-8)
    expect(compute('power', { a: -0.5, b: 2 })).toBe(64)
    expect(compute('power', { a: -0.5, b: 0.5 })).toBe(0)
    expect(compute('logarithm', { a: 8, b: 1 })).toBe(0)
    expect(MATH_OPS.modulo.js(-1.5, 1)).toBe(-0.5)
    expect(MATH_OPS.flooredModulo.js(-1.5, 1)).toBe(0.5)
  })

  it('goes through vectors per component', () => {
    const { leds } = renderGraph(graph([node('c', 'color', { color: [0.24, 0.5, 0.8] }), node('m', 'math', { op: 'multiply', b: 0.5 }), node('o', 'output')], [['c.color', 'm.a'], ['m.result', 'o.color']]), { leds: 1 })
    expect(leds[0]).toEqual([31, 64, 102])
  })

  it('every operation is in the add menu under its own name', () => {
    const presets = flattenFs(GRAPH_FS.items).filter((row) => row.preset && row.path.includes('Math Operations'))
    expect(presets.map((row) => row.preset!.title)).toEqual(expect.arrayContaining(['Sine', 'Ping-Pong', 'Arctan2', 'Multiply Add']))
    expect(presets.every((row) => row.node === mathNode)).toBe(true)
    expect(presets).toHaveLength(Object.keys(MATH_OPS).length)
  })
})
