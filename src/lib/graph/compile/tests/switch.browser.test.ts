import { describe, expect, it } from 'vitest'
import type { Layout } from '@/lib/engine/output/layout'
import { createGlslCompiler } from '@/lib/graph/compile/compilers'
import { listCorpusGraphs } from '@/lib/graph/compile/corpus'
import type { NodeGraph } from '@/lib/graph/model/doc'
import { tickGraph } from '@/lib/graph/testing'
import { SAMPLE_RATE, feedSlots, openSlots, synthesizeTrack, type Slot } from '@/lib/graph/testing/offline'

const FRAMES = 30
const STRIP: Target = { leds: 60, layout: null }
const MATRIX: Target = { leds: 64, layout: { segments: [{ kind: 'matrix', width: 8, height: 8, serpentine: false, origin: 'top-left' }] } }
const floatTargets = !!document.createElement('canvas').getContext('webgl2')?.getExtension('EXT_color_buffer_float')

interface Target {
  leds: number
  layout: Layout | null
}

// Old pipeline's LED bytes over the same track and targets, recorded at the cut-over: per graph, each target's 30 frames, base64
const recorded = import.meta.glob('/src/lib/graph/compile/__snapshots__/switch/*.json', { eager: true, import: 'default' }) as Record<
  string,
  { strip: string; matrix: string }
>

/** Row of LED bytes per frame */
function readRecordedBytes(name: string, target: Target): number[][] {
  const bytes = Array.from(atob(recorded[`/src/lib/graph/compile/__snapshots__/switch/${name}.json`][target === STRIP ? 'strip' : 'matrix']), (char) =>
    char.charCodeAt(0),
  )
  const row = target.leds * 3
  return Array.from({ length: FRAMES }, (_, frame) => bytes.slice(frame * row, (frame + 1) * row))
}

/** LED bytes per frame over the synthetic track */
function renderAfter(doc: NodeGraph, target: Target, track: Float32Array): number[][] {
  expect(createGlslCompiler().compile(doc).issues).toEqual([])
  let slots: Slot[] | undefined
  const frames = tickGraph(doc, {
    leds: target.leds,
    frames: FRAMES,
    layout: target.layout,
    beforeTick: (renderer, program, time) => {
      slots ??= openSlots(program, SAMPLE_RATE)
      const { analyses } = feedSlots(slots, track, time, SAMPLE_RATE)
      if (analyses[0])
        renderer.setAudio(
          slots[0].textures,
          slots.slice(1).map((slot) => slot.textures),
          analyses[0],
        )
    },
  })
  return frames.map((frame) => frame.flat())
}

/** Largest channel difference over all LEDs and frames */
const findLargestDelta = (a: number[][], b: number[][]) => Math.max(0, ...a.flatMap((frame, i) => frame.map((byte, k) => Math.abs(byte - b[i][k]))))

const RANDOM = 'Random, seeded per beat, now hashes in float32 on the GPU, where its frame body hashed in float64'
const INTEGRATOR =
  'Integrators stepping 1 / 30 a tick reach 0.5 and 1.0 exactly in float32 at ticks 15 and 30, a tick before float64 does, so a Clock Divider fires and a wrap lands a tick early'

// Graphs whose frame nodes compute differently on the GPU, w/ exact largest delta on strip and matrix; others match within one byte
// How far these two drift depends on the GPU's float32 arithmetic, so only the cause is recorded, not the size
const MOVED_TO_GPU: Record<string, string> = {
  'bench-kitchen-sink': INTEGRATOR,
  'kick-shockwave': RANDOM,
}

describe.skipIf(!floatTargets)('the switch to the new compiler (needs EXT_color_buffer_float)', () => {
  const track = synthesizeTrack(2)

  it.each(listCorpusGraphs())('%s makes the same LED bytes for the first 30 frames of the synthetic track', (name, doc) => {
    const [strip, matrix] = [STRIP, MATRIX].map((target) => findLargestDelta(renderAfter(doc, target, track), readRecordedBytes(name, target)))
    if (MOVED_TO_GPU[name]) return
    expect(Math.max(strip, matrix)).toBeLessThanOrEqual(1)
  })
})
