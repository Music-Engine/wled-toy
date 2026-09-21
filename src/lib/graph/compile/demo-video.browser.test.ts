import { describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { rangePeak } from '@/lib/audio/dsp'
import { layoutPositions } from '@/lib/engine/layout'
import { ShaderRenderer } from '@/lib/engine/renderer'
import { generateGlsl } from './compile'
import { ControlRunner } from './control'
import { readGraphFile } from '@/lib/graph/model/file'
import { SAMPLE_RATE, feedSlots, openSlots } from '@/lib/graph/testing/offline'

// Renders graphs against real song excerpts for a demo video. Only runs with VITE_DEMO_VIDEO=1, after a manifest and
// 48 kHz mono f32 excerpts exist in .work/demo-video/; whatever composites the video reads the .leds files it writes.
const ENABLED = import.meta.env.VITE_DEMO_VIDEO === '1'
const DIR = '.work/demo-video'
const STRIP_LEDS = 120
const MATRIX_SIDE = 32

const files = import.meta.glob('/graphs/*.wledgraph', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

interface Segment {
  index: number
  graph: string
  seconds: number
  /** Seconds of song before the excerpt, analyzed and rendered so gain, beat tracking and feedback have settled, then dropped. */
  preroll: number
  pcm: string
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
}

function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

const byte = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255)

describe.runIf(ENABLED)('demo video', () => {
  it('renders every segment of the manifest', async () => {
    const manifest = JSON.parse(await commands.readFile(`${DIR}/manifest.json`)) as { fps: number; segments: Segment[] }

    for (const segment of manifest.segments) {
      const { doc, problems } = readGraphFile(files[`/graphs/${segment.graph}.wledgraph`])
      expect(problems, 'structural problems').toEqual([])
      const shader = generateGlsl(doc)
      expect(shader.error, `graph error at node "${shader.errorNode}": ${shader.error}`).toBeNull()

      const track = new Float32Array(fromBase64(await commands.readFile(segment.pcm, 'base64')).buffer)
      const [strip, matrix] = [0, 1].map(() => new ShaderRenderer(document.createElement('canvas')))
      strip.compile(shader.code)
      matrix.compile(shader.code)
      matrix.setLayout(layoutPositions({ segments: [{ kind: 'matrix', width: MATRIX_SIDE, height: MATRIX_SIDE, serpentine: false, origin: 'top-left' }] }))

      const runner = new ControlRunner()
      runner.load(shader.control)
      const slots = openSlots(shader.control, SAMPLE_RATE)

      const skipped = Math.round(segment.preroll * manifest.fps)
      const kept = Math.round(segment.seconds * manifest.fps)
      const bands = slots[0].textures.bandCount
      const frameBytes = (STRIP_LEDS + MATRIX_SIDE * MATRIX_SIDE) * 3 + bands + 3
      const out = new Uint8Array(kept * frameBytes)

      for (let frame = 0; frame < skipped + kept; frame++) {
        const time = frame / manifest.fps
        const tick = { time, dt: 1 / manifest.fps, frame }
        const { analyses } = feedSlots(slots, track, time, SAMPLE_RATE)
        const f = analyses[0]
        const controls = runner.step({ ...tick, audio: f ? { analyses, sampleRate: SAMPLE_RATE } : undefined })
        for (const renderer of [strip, matrix]) {
          renderer.setControls(controls)
          if (f) renderer.setAudio(slots[0].textures, slots.slice(1).map((slot) => slot.textures))
        }
        const leds = [strip.renderLeds({ ...tick, ledCount: STRIP_LEDS, scanY: 0.5 }), matrix.renderLeds({ ...tick, ledCount: MATRIX_SIDE * MATRIX_SIDE, scanY: 0.5 })]
        if (frame < skipped) continue

        let at = (frame - skipped) * frameBytes
        for (const colors of leds) for (const c of colors) out[at++] = byte(c)
        for (let b = 0; b < bands; b++) out[at++] = byte(f?.bands[b] ?? 0)
        out[at++] = byte(f?.level ?? 0)
        out[at++] = byte(f?.gate ? Math.sqrt(rangePeak(f.spectrum, SAMPLE_RATE, f.spectrum.length * 2, 60, 150) * f.gain) : 0)
        out[at++] = f?.beat ? 255 : 0
      }
      strip.dispose()
      matrix.dispose()

      await commands.writeFile(`${DIR}/${segment.index}.leds`, toBase64(out), 'base64')
      await commands.writeFile(`${DIR}/${segment.index}.json`, JSON.stringify({ stripLeds: STRIP_LEDS, matrixSide: MATRIX_SIDE, bands, frames: kept, frameBytes }))
    }
  }, 1_200_000)
})
