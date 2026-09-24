import { describe, expect, it, vi } from 'vitest'
import { ShaderRenderer } from '@/lib/engine/renderer'
import type { NodeGraph } from '@/lib/graph/model/doc'
import { graph, node } from '@/lib/graph/testing'
import { generateGlsl } from './compile'
import { FrameRunner } from './frame'

// the registry has no hook for kinds of its own, so the twins are served beside the catalog
vi.mock('@/lib/graph/registry', async (importOriginal) => {
  const registry = await importOriginal<typeof import('@/lib/graph/registry')>()
  const { defineNode, Float } = await import('@/lib/graph/authoring')
  const common = { description: 'test twin', category: 'signal', input: { rate: { type: Float, default: 0.7 } }, output: { value: Float }, state: { value: Float } } as const
  const twins = [
    defineNode('frameTwin', {
      ...common, title: 'Frame Twin',
      frame: ({ rate }, { state, dt }) => {
        state.value += rate * dt
        return { value: state.value }
      },
    }),
    defineNode('pixelTwin', {
      ...common, title: 'Pixel Twin', stateScope: 'pixel',
      pixel: ({ rate }, ctx) => {
        ctx.emit(`${ctx.state.value.expr} += ${rate.expr} * iTimeDelta;`)
        return { value: ctx.state.value }
      },
    }),
  ]
  return { ...registry, itemFor: (kind: string) => twins.find((item) => item.id === kind) ?? registry.itemFor(kind) }
})

const drawn = (kind: string) => graph([node('t', kind), node('o', 'output')], [['t.value', 'o.color']])
// uneven steps, so a twin that ignored dt would drift apart from the other
const DT = Array.from({ length: 60 }, (_, i) => 1 / 60 + (i % 5) * 0.001)

/** The red channel of a 1-LED strip over the frames, the per-frame side stepped by the engine's runner. */
function sequence(renderer: ShaderRenderer, doc: NodeGraph, dts: number[]): number[] {
  const shader = generateGlsl(doc)
  expect(shader.error).toBeNull()
  renderer.compile(shader.code)
  const runner = new FrameRunner()
  runner.load(shader.frame)
  let time = 0
  return dts.map((dt, frame) => {
    time += dt
    renderer.setControls(runner.step({ time, dt, frameIndex: frame }))
    return renderer.renderLeds({ time, dt, frame, ledCount: 1, scanY: 0.5 })[0]
  })
}

const floatTargets = !!document.createElement('canvas').getContext('webgl2')?.getExtension('EXT_color_buffer_float')

describe.skipIf(!floatTargets)('pixel-scope state (needs EXT_color_buffer_float)', () => {
  it('a frame-scope node and its pixel-scope twin agree over 60 frames on a 1-LED strip', () => {
    const renderer = new ShaderRenderer(document.createElement('canvas'))
    const frame = sequence(renderer, drawn('frameTwin'), DT)
    const pixel = sequence(renderer, drawn('pixelTwin'), DT)
    renderer.dispose()
    // the color targets are half floats: about 3 decimal digits below 1
    pixel.forEach((value, i) => expect(Math.abs(value - frame[i])).toBeLessThan(2e-3))
    expect(frame.at(-1)).toBeCloseTo(0.7 * DT.reduce((sum, dt) => sum + dt), 2)
  })

  it('pixel state restarts at 0 when a new shader is compiled', () => {
    const renderer = new ShaderRenderer(document.createElement('canvas'))
    sequence(renderer, drawn('pixelTwin'), DT.slice(0, 10))
    const [first] = sequence(renderer, drawn('pixelTwin'), [0.1])
    renderer.dispose()
    expect(first).toBeCloseTo(0.07, 3)
  })
})

it('a graph without pixel state compiles to a shader with no state and a renderer that makes no drawBuffers call', () => {
  const shader = generateGlsl(drawn('frameTwin'))
  expect(shader.code).not.toMatch(/iState|outState/)
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
  // the constructor allocates the image layers with texStorage3D, which is not state
  calls.texStorage3D = 0
  renderer.compile(shader.code)
  for (let frame = 0; frame < 3; frame++) {
    renderer.renderLeds({ time: 0, frame, ledCount: 1, scanY: 0.5 })
    renderer.renderPreview({ time: 0, frame, ledCount: 1, scanY: 0.5 })
  }
  expect(calls).toEqual({ drawBuffers: 0, texStorage3D: 0 })
  expect(gl.getError()).toBe(gl.NO_ERROR)
  renderer.dispose()
})
