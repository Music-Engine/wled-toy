import { describe, expect, it, vi } from 'vitest'
import { ShaderRenderer } from '@/lib/engine/render/renderer'
import { Runtime } from '@/lib/engine/runtime'
import { createGlslCompiler } from '@/lib/graph/compile/compilers'
import type { NodeGraph } from '@/lib/graph/model/doc'
import { graph, node } from '@/lib/graph/testing'

// Registry has no hook for test kinds, so it's served beside the catalog, lint's lookups included
vi.mock('@/lib/graph/registry', async (importOriginal) => {
  const registry = await importOriginal<typeof import('@/lib/graph/registry')>()
  const { defineNode, Float } = await import('@/lib/graph/authoring')
  const accumulator = defineNode('accumulator', {
    title: 'Accumulator',
    description: 'test',
    category: 'signal',
    input: { rate: { type: Float, default: 0.7 } },
    output: { value: Float },
    state: { value: Float },
    body: ({ rate }, ctx) => {
      ctx.emit(`${ctx.state.value.expr} += ${rate.expr} * iTimeDelta;`)
      return { value: ctx.state.value }
    },
  })
  const findNodeItem = (kind: string) => (kind === 'accumulator' ? accumulator : registry.findNodeItem(kind))
  const readStoredShape = (data: { kind: string; values: Record<string, unknown> } | undefined) => data && findNodeItem(data.kind)?.shape(data.values)
  return {
    ...registry,
    findNodeItem,
    readStoredShape,
    findInputSocket: (data: never, handle: string) => readStoredShape(data)?.inputs.find((s) => s.linkable && s.name === handle),
    findOutputSocket: (data: never, handle: string) => readStoredShape(data)?.outputs.find((s) => s.name === handle),
  }
})

/** Accumulator alone, 0.7 a second in the frame pass */
const ALONE = graph([node('t', 'accumulator'), node('o', 'output')], [['t.value', 'o.color']])
/** Same 0.7 from uv.x times 0, so it runs in the pixel pass */
const FED = graph(
  [node('u', 'uv'), node('r', 'math', { op: 'multiplyAdd', b: 0, c: 0.7 }), node('t', 'accumulator'), node('o', 'output')],
  [
    ['u.x', 'r.a'],
    ['r.result', 't.rate'],
    ['t.value', 'o.color'],
  ],
)
// Uneven steps, so a pass ignoring dt drifts apart
const DT = Array.from({ length: 60 }, (_, i) => 1 / 60 + (i % 5) * 0.001)

/** Red channel of a 1-LED strip, one Runtime tick per dt */
function tickRed(renderer: ShaderRenderer, doc: NodeGraph, dts: number[]): number[] {
  const { program, slots, issues } = createGlslCompiler().compile(doc)
  expect(issues).toEqual([])
  const runtime = new Runtime(renderer)
  runtime.load(program!, slots)
  let time = 0
  return dts.map((dt, frame) => {
    time += dt
    return runtime.tick({ time, dt, frame, ledCount: 1, scanY: 0.5 })[0]
  })
}

const floatTargets = !!document.createElement('canvas').getContext('webgl2')?.getExtension('EXT_color_buffer_float')

describe.skipIf(!floatTargets)('pixel-scope state (needs EXT_color_buffer_float)', () => {
  it('a stateful node in the frame pass and the same node fed per pixel agree over 60 frames on a 1-LED strip', () => {
    const renderer = new ShaderRenderer(document.createElement('canvas'))
    expect(createGlslCompiler().compile(ALONE).slots.pixel).toEqual({})
    expect(Object.keys(createGlslCompiler().compile(FED).slots.pixel)).toEqual(['t'])
    const frame = tickRed(renderer, ALONE, DT)
    const pixel = tickRed(renderer, FED, DT)
    renderer.dispose()
    // Half-float color targets: about 3 decimals below 1
    pixel.forEach((value, i) => expect(Math.abs(value - frame[i])).toBeLessThan(2e-3))
    expect(frame.at(-1)).toBeCloseTo(0.7 * DT.reduce((sum, dt) => sum + dt), 2)
  })

  it('pixel state restarts at 0 when a new shader is compiled', () => {
    const renderer = new ShaderRenderer(document.createElement('canvas'))
    tickRed(renderer, FED, DT.slice(0, 10))
    const [first] = tickRed(renderer, FED, [0.1])
    renderer.dispose()
    expect(first).toBeCloseTo(0.07, 3)
  })
})

it('a graph without pixel state compiles to a shader with no state and a renderer that makes no drawBuffers call', () => {
  const { program } = createGlslCompiler().compile(ALONE)
  expect(program!.pixel).not.toMatch(/iState|outState/)
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')!
  const calls = { drawBuffers: 0, texStorage3D: 0 }
  for (const name of Object.keys(calls) as (keyof typeof calls)[]) {
    const original = gl[name].bind(gl) as (...args: unknown[]) => unknown
    ;(gl as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
      calls[name]++
      return original(...args)
    }
  }
  const renderer = new ShaderRenderer(canvas)
  // Constructor's image layers use texStorage3D, which isn't state
  calls.texStorage3D = 0
  renderer.compile(program!.pixel, program!.frame!)
  for (let frame = 0; frame < 3; frame++) {
    renderer.renderGlobalState({ time: 0, frame, ledCount: 1, scanY: 0.5 })
    renderer.renderLeds({ time: 0, frame, ledCount: 1, scanY: 0.5 })
    renderer.renderPreview({ time: 0, frame, ledCount: 1, scanY: 0.5 })
  }
  expect(calls).toEqual({ drawBuffers: 0, texStorage3D: 0 })
  expect(gl.getError()).toBe(gl.NO_ERROR)
  renderer.dispose()
})
