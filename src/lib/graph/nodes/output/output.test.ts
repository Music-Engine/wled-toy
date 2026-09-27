import { expect, it } from 'vitest'
import { DEFAULT_OUTPUT } from '@/lib/engine/output'
import { generateGlsl } from '@/lib/graph'
import { graph, node } from '@/lib/graph/testing'

it('an untouched Output node asks for nothing: Settings stay in charge', () => {
  expect(generateGlsl(graph([node('o', 'output')])).output).toEqual(DEFAULT_OUTPUT)
})

it('the Output node carries its wire settings out of the compiler, and its color input still compiles', () => {
  const { output, code } = generateGlsl(graph([node('o', 'output', { protocol: 'artnet', universe: 3, fps: 50, gamma: 2.2, powerBudgetMa: 2000, dithering: 'temporal', color: [0, 1, 0] })]))
  expect(output).toEqual({ ...DEFAULT_OUTPUT, protocol: 'artnet', universe: 3, fps: 50, gamma: 2.2, powerBudgetMa: 2000, dithering: 'temporal' })
  expect(code).toContain('c = vec4(vec3(0.0, 1.0, 0.0), 1.0);')
})

it('a graph without an Output has no settings', () => {
  expect(generateGlsl(graph([node('v', 'value')])).output).toBeNull()
})

it('a second Output is left out with an issue on it, and the first one decides the settings', () => {
  const shader = generateGlsl(graph([node('a', 'output', { universe: 3, color: [0, 1, 0] }), node('b', 'output', { universe: 7, color: [1, 0, 0] })]))
  expect(shader.output?.universe).toBe(3)
  expect(shader.issues).toEqual([{ nodeId: 'b', message: 'Only the first Output ("a") drives the LEDs; this one is left out' }])
  expect(shader.code).toContain('c = vec4(vec3(0.0, 1.0, 0.0), 1.0);')
  expect(shader.code).not.toContain('vec3(1.0, 0.0, 0.0)')
})
