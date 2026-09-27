import { expect, it } from 'vitest'
import { ShaderRenderer } from '@/lib/engine/render/renderer'
import { FrameRunner, generateGlsl } from '@/lib/graph'
import { graph, node, renderGraph, toByte } from '@/lib/graph/testing'

it('Knob(0.25) -> Output lights every LED at 64', () => {
  const { leds, compileError } = renderGraph(graph([node('k', 'knob', { value: 0.25 }), node('o', 'output')], [['k.value', 'o.color']]), { leds: 3 })
  expect(compileError).toBeNull()
  expect(leds).toEqual([[64, 64, 64], [64, 64, 64], [64, 64, 64]])
})

it('turning the knob changes the LEDs on the same compiled program', () => {
  const doc = (value: number) => graph([node('k', 'knob', { value }), node('o', 'output')], [['k.value', 'o.color']])
  const renderer = new ShaderRenderer(document.createElement('canvas'))
  const runner = new FrameRunner()
  renderer.compile(generateGlsl(doc(0.25)).code)
  const red = (value: number) => {
    runner.load(generateGlsl(doc(value)).frame)
    renderer.setControls(runner.step({ time: 0, dt: 1 / 30, frameIndex: 0, audio: undefined, midi: undefined, osc: undefined }))
    return toByte(renderer.renderLeds({ time: 0, frame: 0, ledCount: 1, scanY: 0.5 })[0])
  }
  expect([red(0.25), red(1), red(0)]).toEqual([64, 255, 0])
})

it('Time reaches the shader as a per-frame value', () => {
  const { leds } = renderGraph(graph([node('t', 'time'), node('o', 'output')], [['t.time', 'o.color']]), { leds: 1, time: 0.5 })
  expect(leds[0]).toEqual([128, 128, 128])
})
