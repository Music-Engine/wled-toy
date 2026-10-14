import { describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { rangePeak, type Features } from '@/lib/audio/dsp'
import { layoutPositions } from '@/lib/engine/output/layout'
import { ShaderRenderer } from '@/lib/engine/render/renderer'
import { Runtime } from '@/lib/engine/runtime'
import { createGlslCompiler } from '@/lib/graph/compile/compilers'
import { readGraphFile } from '@/lib/graph/model/file'
import { toByte } from './index'
import { SAMPLE_RATE, feedSlots, openSlots } from './offline'

// Only w/ VITE_DEMO_VIDEO=1, once a manifest and 48 kHz mono f32 excerpts exist in .work/demo-video/; the video
// compositor reads the .leds files written here
const ENABLED = import.meta.env.VITE_DEMO_VIDEO === '1'
const DIR = '.work/demo-video'
const STRIP_LEDS = 120
const MATRIX_SIDE = 32

const files = import.meta.glob('/graphs/*.wledgraph', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

interface Segment {
  index: number
  graph: string
  seconds: number
  /** Song seconds before the excerpt, rendered so gain, beat tracking and feedback settle, then dropped */
  preroll: number
  pcm: string
}

describe.runIf(ENABLED)('demo video', () => {
  it('renders every segment of the manifest', async () => {
    const manifest = JSON.parse(await commands.readFile(`${DIR}/manifest.json`)) as { fps: number; segments: Segment[] }
    for (const segment of manifest.segments) {
      const { out, bands, frames, frameBytes } = await renderSegment(segment, manifest.fps)
      await commands.writeFile(`${DIR}/${segment.index}.leds`, toBase64(out), 'base64')
      await commands.writeFile(`${DIR}/${segment.index}.json`, JSON.stringify({ stripLeds: STRIP_LEDS, matrixSide: MATRIX_SIDE, bands, frames, frameBytes }))
    }
  }, 1_200_000)
})

/** Strip and matrix bytes, then bands, level, kick and beat, per kept frame */
async function renderSegment(segment: Segment, fps: number) {
  const { program, strip, matrix, runtimes } = loadSegmentGraph(segment)
  const track = new Float32Array(decodeBase64(await commands.readFile(segment.pcm, 'base64')).buffer)
  const slots = openSlots(program, SAMPLE_RATE)
  const [skipped, frames] = [Math.round(segment.preroll * fps), Math.round(segment.seconds * fps)]
  const bands = slots[0].textures.bandCount
  const frameBytes = (STRIP_LEDS + MATRIX_SIDE * MATRIX_SIDE) * 3 + bands + 3
  const out = new Uint8Array(frames * frameBytes)
  for (let frame = 0; frame < skipped + frames; frame++) {
    const tick = { time: frame / fps, dt: 1 / fps, frame, scanY: 0.5 }
    const [features] = feedSlots(slots, track, tick.time, SAMPLE_RATE).analyses
    if (features)
      for (const renderer of [strip, matrix])
        renderer.setAudio(
          slots[0].textures,
          slots.slice(1).map((slot) => slot.textures),
          features,
        )
    const leds = [runtimes[0].tick({ ...tick, ledCount: STRIP_LEDS }), runtimes[1].tick({ ...tick, ledCount: MATRIX_SIDE * MATRIX_SIDE })]
    if (frame >= skipped) writeFrame(out.subarray((frame - skipped) * frameBytes), leds, features, bands)
  }
  strip.dispose()
  matrix.dispose()
  return { out, bands, frames, frameBytes }
}

function loadSegmentGraph(segment: Segment) {
  const { doc, problems } = readGraphFile(files[`/graphs/${segment.graph}.wledgraph`])
  expect(problems, 'structural problems').toEqual([])
  const { program, slots: table, issues } = createGlslCompiler().compile(doc)
  expect(program, JSON.stringify(issues)).not.toBeNull()
  const [strip, matrix] = [0, 1].map(() => new ShaderRenderer(document.createElement('canvas')))
  const runtimes = [strip, matrix].map((renderer) => new Runtime(renderer))
  for (const runtime of runtimes) runtime.load(program!, table)
  matrix.setLayout(layoutPositions({ segments: [{ kind: 'matrix', width: MATRIX_SIDE, height: MATRIX_SIDE, serpentine: false, origin: 'top-left' }] }))
  return { program: program!, strip, matrix, runtimes }
}

function writeFrame(out: Uint8Array, leds: Float32Array[], features: Features | null, bands: number) {
  let at = 0
  for (const colors of leds) for (const channel of colors) out[at++] = toByte(channel)
  for (let band = 0; band < bands; band++) out[at++] = toByte(features?.bands[band] ?? 0)
  out[at++] = toByte(features?.level ?? 0)
  out[at++] = toByte(features?.gate ? Math.sqrt(rangePeak(features.spectrum, SAMPLE_RATE, features.spectrum.length * 2, 60, 150) * features.gain) : 0)
  out[at++] = features?.beat ? 255 : 0
}

function decodeBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
}

function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}
