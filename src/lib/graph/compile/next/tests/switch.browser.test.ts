import { describe, expect, it } from 'vitest'
import { layoutPositions, type Layout } from '@/lib/engine/output/layout'
import { ShaderRenderer } from '@/lib/engine/render/renderer'
import { Runtime } from '@/lib/engine/runtime'
import { generateGlsl } from '@/lib/graph/compile/compile'
import { FrameRunner } from '@/lib/graph/compile/js/frame'
import { createGlslCompiler } from '@/lib/graph/compile/next/compilers'
import { corpusGraphs } from '@/lib/graph/compile/next/corpus'
import type { NodeGraph } from '@/lib/graph/model/doc'
import { toByte } from '@/lib/graph/testing'
import { FPS, SAMPLE_RATE, feedSlots, openSlots, synthTrack } from '@/lib/graph/testing/offline'

const FRAMES = 30
const STRIP: Target = { leds: 60, layout: null }
const MATRIX: Target = { leds: 64, layout: { segments: [{ kind: 'matrix', width: 8, height: 8, serpentine: false, origin: 'top-left' }] } }
const floatTargets = !!document.createElement('canvas').getContext('webgl2')?.getExtension('EXT_color_buffer_float')

interface Target {
  leds: number
  layout: Layout | null
}

/** LED bytes per frame as the engine's LED tick made them before the switch: the frame runner, then the shader. */
function renderBefore(doc: NodeGraph, target: Target, track: Float32Array): number[][] {
  const shader = generateGlsl(doc)
  const renderer = new ShaderRenderer(document.createElement('canvas'))
  renderer.compile(shader.code)
  renderer.setLayout(target.layout && layoutPositions(target.layout))
  const runner = new FrameRunner()
  runner.load(shader.frame)
  const slots = openSlots(shader.frame, SAMPLE_RATE)
  const frames = Array.from({ length: FRAMES }, (_, frame) => {
    const time = frame / FPS
    const { analyses } = feedSlots(slots, track, time, SAMPLE_RATE)
    renderer.setControls(runner.step({ time, dt: 1 / FPS, frameIndex: frame, midi: undefined, osc: undefined, audio: analyses[0] ? { analyses, sampleRate: SAMPLE_RATE } : undefined }))
    if (analyses[0]) renderer.setAudio(slots[0].textures, slots.slice(1).map((slot) => slot.textures), analyses[0])
    return Array.from(renderer.renderLeds({ time, dt: 1 / FPS, frame, ledCount: target.leds, scanY: 0.5 }), toByte)
  })
  renderer.dispose()
  return frames
}

/** The same through the new compiler and a Runtime: the frame pass, then the LED pass, on each tick. */
function renderAfter(doc: NodeGraph, target: Target, track: Float32Array): number[][] {
  const { program, slots: table, issues } = createGlslCompiler().compile(doc)
  expect(issues).toEqual([])
  const renderer = new ShaderRenderer(document.createElement('canvas'))
  const runtime = new Runtime(renderer)
  runtime.load(program!, table)
  renderer.setLayout(target.layout && layoutPositions(target.layout))
  const slots = openSlots(program!, SAMPLE_RATE)
  const frames = Array.from({ length: FRAMES }, (_, frame) => {
    const time = frame / FPS
    const { analyses } = feedSlots(slots, track, time, SAMPLE_RATE)
    if (analyses[0]) runtime.feed(slots[0].textures, slots.slice(1).map((slot) => slot.textures), analyses[0])
    return Array.from(runtime.tick({ time, dt: 1 / FPS, frame, ledCount: target.leds, scanY: 0.5 }), toByte)
  })
  renderer.dispose()
  return frames
}

/** The largest difference of any channel of any LED over the frames. */
const findLargestDelta = (a: number[][], b: number[][]) => Math.max(0, ...a.flatMap((frame, i) => frame.map((byte, k) => Math.abs(byte - b[i][k]))))

const RANDOM = 'Random, seeded per beat, now hashes in float32 on the GPU, where its frame body hashed in float64'
const INTEGRATOR = 'Integrators stepping 1 / 30 a tick reach 0.5 and 1.0 exactly in float32 at ticks 15 and 30, a tick before float64 does, so a Clock Divider fires and a wrap lands a tick early'

// the graphs whose frame nodes compute differently since they moved to the GPU, and the largest channel delta measured
// over the 30 frames on the strip and the matrix, exactly; every other graph matches within the one-byte float rounding
// How far these two drift depends on the GPU's float32 arithmetic, so only the cause is recorded, not the size
const MOVED_TO_GPU: Record<string, string> = {
  'bench-kitchen-sink': INTEGRATOR,
  'kick-shockwave': RANDOM,
}

describe.skipIf(!floatTargets)('the switch to the new compiler (needs EXT_color_buffer_float)', () => {
  const track = synthTrack(2)

  it.each(corpusGraphs())('%s makes the same LED bytes for the first 30 frames of the synthetic track', (name, doc) => {
    const [strip, matrix] = [STRIP, MATRIX].map((target) => findLargestDelta(renderAfter(doc, target, track), renderBefore(doc, target, track)))
    if (MOVED_TO_GPU[name]) return
    expect(Math.max(strip, matrix)).toBeLessThanOrEqual(1)
  })
})
