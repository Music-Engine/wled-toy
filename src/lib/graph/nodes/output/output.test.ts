import { expect, it } from 'vitest'
import { DEFAULT_OUTPUT } from '@/lib/engine/output/output'
import { createGlslCompiler, type NodeGraph } from '@/lib/graph'
import { graph, node } from '@/lib/graph/testing'

const compile = (doc: NodeGraph) => createGlslCompiler().compile(doc)

it('an untouched Output node asks for nothing: Settings stay in charge', () => {
  expect(compile(graph([node('o', 'output')])).program!.output).toEqual(DEFAULT_OUTPUT)
})

it('the Output node carries its wire settings out of the compiler, and its color input still compiles', () => {
  const { program } = compile(graph([node('o', 'output', { protocol: 'artnet', universe: 3, fps: 50, gamma: 2.2, powerBudgetMa: 2000, dithering: 'temporal', color: [0, 1, 0] })]))
  expect(program!.output).toEqual({ ...DEFAULT_OUTPUT, protocol: 'artnet', universe: 3, fps: 50, gamma: 2.2, powerBudgetMa: 2000, dithering: 'temporal' })
  expect(program!.pixel).toContain('c = vec4(vec3(0.0, 1.0, 0.0), 1.0);')
})

it('a graph without an Output compiles to nothing and says why', () => {
  const { program, issues } = compile(graph([node('v', 'value')]))
  expect(program).toBeNull()
  expect(issues).toEqual([{ nodeId: null, message: 'Add an Output node to see anything.' }])
})

it('a second Output is left out with an issue on it, and the first one decides the settings', () => {
  const { program, issues } = compile(graph([node('a', 'output', { universe: 3, color: [0, 1, 0] }), node('b', 'output', { universe: 7, color: [1, 0, 0] })]))
  expect(program!.output?.universe).toBe(3)
  expect(issues).toEqual([{ nodeId: 'b', message: 'Only the first Output ("a") drives the LEDs; this one is left out' }])
  expect(program!.pixel).toContain('c = vec4(vec3(0.0, 1.0, 0.0), 1.0);')
  expect(program!.pixel).not.toContain('vec3(1.0, 0.0, 0.0)')
})
