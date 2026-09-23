import { describe, expect, it } from 'vitest'
import { createDefaultGraph, FrameRunner, generateGlsl, type FramePlan } from '@/lib/graph'
import { castFrameValue, type FrameBinding } from './frame'
import { defineNode } from '@/lib/graph/define/define'
import { Float } from '@/lib/graph/define/socket-types'
import { graph, node } from '@/lib/graph/testing'

const frame = (n: number) => ({ time: n / 30, dt: 1 / 30, frameIndex: n })

describe('castFrameValue', () => {
  it('follows the GLSL cast rules on plain numbers', () => {
    expect(castFrameValue(0.5, 3)).toEqual([0.5, 0.5, 0.5])
    expect(castFrameValue([1, 2, 3, 4], 2)).toEqual([1, 2])
    expect(castFrameValue([1, 2], 4)).toEqual([1, 2, 0, 1])
    expect(castFrameValue([7, 8, 9], 1)).toBe(7)
  })
})

describe('FrameRunner', () => {
  const counter = defineNode('testCounter', {
    title: 'Counter', description: '', category: 'signal',
    input: { step: { type: Float, default: 1 } },
    output: { count: Float },
    state: () => ({ count: 0 }),
    run: ({ step }, state) => ({ count: (state.count += step as number) }),
  })
  const plan = (step: number): FramePlan => ({
    steps: [{ nodeId: 'c', kind: counter.id, run: counter.base.run!, state: counter.base.state, inputs: { step: { constant: step } }, dims: { step: 1 } }],
    exports: [{ step: 0, output: 'count', slot: 5, dim: 1 }],
    resources: {},
  })

  it('keeps state between frames and across a new plan for the same node', () => {
    const runner = new FrameRunner()
    runner.load(plan(1))
    runner.step(frame(0))
    expect(runner.step(frame(1))[5]).toBe(2)
    runner.load(plan(10))
    expect(runner.step(frame(2))[5]).toBe(12)
  })

  it('drops state when the node is gone or the clock is reset', () => {
    const runner = new FrameRunner()
    runner.load(plan(1))
    runner.step(frame(0))
    runner.load({ steps: [], exports: [], resources: {} })
    runner.load(plan(1))
    expect(runner.step(frame(1))[5]).toBe(1)
    runner.reset()
    expect(runner.step(frame(2))[5]).toBe(1)
  })

  it('refuses a plan that names an unknown frame builtin', () => {
    const unknown = { ...plan(1), steps: [{ ...plan(1).steps[0], inputs: { step: { frame: 'tick' } as unknown as FrameBinding } }] }
    expect(() => new FrameRunner().load(unknown)).toThrow('"tick"')
  })

  it('every input binding survives JSON, including a frame builtin', () => {
    const wave = graph([node('k', 'knob'), node('w', 'wave'), node('o', 'output')], [['k.value', 'w.frequency'], ['w.value', 'o.color']])
    for (const doc of [createDefaultGraph(), wave]) {
      const { steps } = generateGlsl(doc).control
      const parsed: FramePlan = JSON.parse(JSON.stringify({ steps }))
      steps.forEach((step, i) => expect(parsed.steps[i].inputs).toEqual(step.inputs))
    }
    expect(generateGlsl(wave).control.steps.flatMap((step) => Object.values(step.inputs))).toContainEqual({ frame: 'time' })
  })
})

describe('domains', () => {
  it('a knob reaches the shader through the uniform block, so its value is not in the code', () => {
    const doc = (value: number) => graph([node('k', 'knob', { value }), node('o', 'output')], [['k.value', 'o.color']])
    const a = generateGlsl(doc(0.25))
    const b = generateGlsl(doc(0.75))
    expect(a.error).toBeNull()
    expect(a.code).toBe(b.code)
    expect(a.code).toContain('c = vec4(vec3(iControl[0].x), 1.0);')
    expect(a.control.exports).toEqual([{ step: 0, output: 'value', slot: 0, dim: 1 }])
  })

  it('math fed only by control values runs on the CPU; fed by uv it stays in the shader and reads the knob from a uniform', () => {
    const cpu = generateGlsl(graph([node('k', 'knob'), node('m', 'math', { op: 'add', b: 0.25 }), node('o', 'output')], [['k.value', 'm.a'], ['m.result', 'o.color']]))
    expect(cpu.control.steps.map((s) => s.nodeId)).toEqual(['k', 'm'])
    expect(cpu.control.exports).toHaveLength(1)
    expect(cpu.code).not.toContain('n_m')

    const gpu = generateGlsl(graph([node('k', 'knob'), node('uv', 'uv'), node('m', 'math', { op: 'add' }), node('o', 'output')], [['k.value', 'm.a'], ['uv.x', 'm.b'], ['m.result', 'o.color']]))
    expect(gpu.control.steps.map((s) => s.nodeId)).toEqual(['k'])
    expect(gpu.code).toContain('float n_m = iControl[0].x + uv.x;')
  })

  it('a CPU chain exports only the value the shader reads', () => {
    const { code, control } = generateGlsl(graph(
      [node('k', 'knob'), node('t', 'time'), node('m', 'math', { op: 'add' }), node('uv', 'uv'), node('m2', 'math'), node('o', 'output')],
      [['t.delta', 'm.a'], ['k.value', 'm.b'], ['m.result', 'm2.a'], ['uv.x', 'm2.b'], ['m2.result', 'o.color']],
    ))
    expect(control.exports).toEqual([{ step: 2, output: 'result', slot: 0, dim: 1 }])
    expect(code).toContain('iControl[0].x + uv.x')
  })
})

describe('control-rate sinks', () => {
  it('a Scene Switch runs although nothing links from it to the Output, and its index can be read back', () => {
    const { control, error } = generateGlsl(graph(
      [node('k', 'knob', { value: 2.4, max: 8 }), node('s', 'sceneSwitch'), node('c', 'color'), node('o', 'output')],
      [['k.value', 's.index'], ['c.color', 'o.color']],
    ))
    expect(error).toBeNull()
    expect(control.steps.map((s) => s.nodeId)).toEqual(['k', 's'])
    expect(control.exports).toEqual([])
    const runner = new FrameRunner()
    runner.load(control)
    runner.step(frame(0))
    expect(runner.output('s', 'scene')).toBe(2)
    expect(runner.output('missing', 'scene')).toBeUndefined()
  })

  it('a graph with only a Scene Switch still asks for an Output', () => {
    expect(generateGlsl(graph([node('s', 'sceneSwitch')])).error).toMatch(/Output node/)
  })
})
