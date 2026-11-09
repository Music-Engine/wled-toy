import { describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import type { Layout } from '@/lib/engine/output/layout'
import { createGlslCompiler } from '@/lib/graph/compile/compilers'
import { listCorpusGraphs } from '@/lib/graph/compile/corpus'
import type { NodeGraph } from '@/lib/graph/model/doc'
import { tickGraph } from '@/lib/graph/testing'
import { SAMPLE_RATE, feedSlots, openSlots, synthesizeTrack, type Slot } from '@/lib/graph/testing/offline'

const FRAMES = 30
const SNAPSHOTS = 'src/lib/graph/compile/__snapshots__/switch'
// Goldens are the bytes Playwright's Chromium on SwiftShader makes on ubuntu-22.04, the only machine that reproduces them bit for bit
// 'check' asserts against them (CI), 'record' rewrites them (the record-switch-bytes workflow), unset only reports drift (a dev machine)
const MODE = import.meta.env.VITE_SWITCH_BYTES as 'check' | 'record' | undefined
const STRIP: Target = { leds: 60, layout: null }
const MATRIX: Target = { leds: 64, layout: { segments: [{ kind: 'matrix', width: 8, height: 8, serpentine: false, origin: 'top-left' }] } }
const floatTargets = !!document.createElement('canvas').getContext('webgl2')?.getExtension('EXT_color_buffer_float')

interface Target {
  leds: number
  layout: Layout | null
}

// Per graph, each target's 30 frames of LED bytes, base64
const recorded = import.meta.glob('/src/lib/graph/compile/__snapshots__/switch/*.json', { eager: true, import: 'default' }) as Record<
  string,
  { strip: string; matrix: string }
>

/** Row of LED bytes per frame */
function readRecordedBytes(name: string, target: Target): number[][] {
  const bytes = Array.from(atob(recorded[`/${SNAPSHOTS}/${name}.json`][target === STRIP ? 'strip' : 'matrix']), (char) => char.charCodeAt(0))
  const row = target.leds * 3
  return Array.from({ length: FRAMES }, (_, frame) => bytes.slice(frame * row, (frame + 1) * row))
}

const toBase64 = (frames: number[][]) => btoa(String.fromCharCode(...frames.flat()))

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

describe.skipIf(!floatTargets)('the LED bytes of the corpus (needs EXT_color_buffer_float)', () => {
  const track = synthesizeTrack(2)

  for (const [name, doc] of listCorpusGraphs())
    it(`${name} makes the recorded LED bytes for the first 30 frames of the synthetic track`, async ({ annotate }) => {
      const [strip, matrix] = [STRIP, MATRIX].map((target) => renderAfter(doc, target, track))
      if (MODE === 'record') {
        await commands.writeFile(`${SNAPSHOTS}/${name}.json`, `${JSON.stringify({ strip: toBase64(strip), matrix: toBase64(matrix) }, null, 2)}\n`)
        return
      }
      const delta = Math.max(findLargestDelta(strip, readRecordedBytes(name, STRIP)), findLargestDelta(matrix, readRecordedBytes(name, MATRIX)))
      if (MODE === 'check') expect(delta).toBeLessThanOrEqual(1)
      else if (delta > 1) await annotate(`LED bytes drift by up to ${delta} from the ubuntu-22.04 goldens on this machine`)
    })
})
