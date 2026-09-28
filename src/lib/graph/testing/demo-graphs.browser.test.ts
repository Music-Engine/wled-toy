import { describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { rangePeak, type Features } from '@/lib/audio/dsp'
import { DEFAULT_ANALYSIS } from '@/lib/audio/settings'
import { layoutPositions } from '@/lib/engine/output/layout'
import { ShaderRenderer } from '@/lib/engine/render/renderer'
import { Runtime } from '@/lib/engine/runtime'
import { createGlslCompiler, type GlslProgram, type SlotTable } from '@/lib/graph/compile/compilers'
import type { NodeGraph } from '@/lib/graph/model/doc'
import { readGraphFile } from '@/lib/graph/model/file'
import { readStoredShape } from '@/lib/graph/registry'
import { drawMatrixSheet, drawTimeline, writePng } from './demo/sheets'
import type { FrameAudio, Run } from './demo/run'
import { computeStats } from './demo/stats'
import { graph, node } from './index'
import { FPS, SAMPLE_RATE, SECONDS, feedSlots, openSlots, synthesizeTrack } from './offline'

const PREVIEW = import.meta.env.VITE_GRAPH_PREVIEW === '1'
const ONLY = import.meta.env.VITE_GRAPH_ONLY as string | undefined
const STRIP_LEDS = PREVIEW ? 120 : 60
const MATRIX_SIDE = PREVIEW ? 32 : 8

const files = import.meta.glob('/graphs/*.wledgraph', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const graphs = Object.entries(files).map(([path, text]) => [path.split('/').pop()!.replace('.wledgraph', ''), text] as const)

describe('demo graphs', () => {
  const track = synthesizeTrack()

  it('finds the graphs it is meant to check', () => {
    expect(graphs.filter(([name]) => !ONLY || name === ONLY)).not.toEqual([])
  })

  it.each(graphs.filter(([name]) => !ONLY || name === ONLY))(
    '%s is valid, renders and reacts to music',
    async (name, text) => {
      const { doc, problems } = readGraphFile(text)
      expect(problems, 'structural problems').toEqual([])

      const run = play(doc, track)
      expect(
        run.strip.some((leds) => leds.some(Number.isNaN)),
        'NaN in the LED colors',
      ).toBe(false)
      expect(
        run.strip.some((leds) => leds.some((channel) => channel > 0.02)),
        'every LED is black for the whole run',
      ).toBe(true)
      expect(
        run.strip.some((leds) => leds.some((channel, i) => Math.abs(channel - run.strip[0][i]) > 0.02)),
        'the output never changes over time',
      ).toBe(true)

      if (!PREVIEW) return
      const dir = `.work/graph-previews/${name}`
      await writePng(
        `${dir}/strip-timeline.png`,
        drawTimeline(run, run.strip, `x: LED 0 (uv.x = 0) to LED ${STRIP_LEDS - 1}, y: time running downward, ${FPS} rows per second`),
      )
      await writePng(`${dir}/matrix-sheet.png`, drawMatrixSheet(run, MATRIX_SIDE))
      await commands.writeFile(`${dir}/stats.json`, JSON.stringify(computeStats(run, listWarnings(doc), STRIP_LEDS, MATRIX_SIDE), null, 1))
    },
    300_000,
  )

  it.runIf(PREVIEW)(
    'draws what the analyzer hears in the test track',
    async () => {
      const run = play(graph([node('o', 'output')]), track)
      const toGrey = (levels: Float32Array) => [...levels].flatMap((level) => [level, level, level])
      const rows = run.audio.map((audio) => Float32Array.from([...toGrey(audio.bands), 0, 0.2, 0, ...toGrey(audio.chroma)]))
      await writePng(
        '.work/graph-previews/track.png',
        drawTimeline(run, rows, 'x: the 64 default FFT bands, 40 Hz to 16 kHz (mel), then the 12 pitch classes C to B; y: time'),
      )
    },
    300_000,
  )
})

/** Engine's LED tick offline: hops up to the frame's time analyzed, then audio upload, frame pass, LED render */
function play(doc: NodeGraph, track: Float32Array): Run {
  const { program, slots: table, issues } = createGlslCompiler().compile(doc)
  expect(
    issues.map((issue) => `${issue.nodeId}: ${issue.message}`),
    'graph issues',
  ).toEqual([])
  const [strip, matrix] = [0, 1].map(() => new ShaderRenderer(document.createElement('canvas')))
  const [stripRuntime, matrixRuntime] = loadRuntimes([strip, matrix], program!, table)
  matrix.setLayout(layoutPositions({ segments: [{ kind: 'matrix', width: MATRIX_SIDE, height: MATRIX_SIDE, serpentine: false, origin: 'top-left' }] }))
  const slots = openSlots(program!, SAMPLE_RATE)
  const run: Run = { strip: [], matrix: [], audio: [] }
  for (let frame = 0; frame < SECONDS * FPS; frame++) {
    const tick = { time: frame / FPS, dt: 1 / FPS, frame, scanY: 0.5 }
    const [features] = feedSlots(slots, track, tick.time, SAMPLE_RATE).analyses
    run.audio.push(readFrameAudio(features))
    if (features)
      for (const renderer of [strip, matrix])
        renderer.setAudio(
          slots[0].textures,
          slots.slice(1).map((slot) => slot.textures),
          features,
        )
    run.strip.push(stripRuntime.tick({ ...tick, ledCount: STRIP_LEDS }).slice())
    run.matrix.push(matrixRuntime.tick({ ...tick, ledCount: MATRIX_SIDE * MATRIX_SIDE }).slice())
  }
  strip.dispose()
  matrix.dispose()
  return run
}

/** A GLSL error names the node that emitted the line */
function loadRuntimes(renderers: ShaderRenderer[], program: GlslProgram, table: SlotTable): Runtime[] {
  const runtimes = renderers.map((renderer) => new Runtime(renderer))
  try {
    for (const runtime of runtimes) runtime.load(program, table)
  } catch (e) {
    const message = (e as Error).message
    const line = Number(/ERROR: \d+:(\d+)/.exec(message)?.[1])
    throw new Error(`GLSL compile error at node "${program.lineNodes.pixel[line] ?? 'unknown'}": ${message}\n${program.pixel}`)
  }
  return runtimes
}

function readFrameAudio(features: Features | null): FrameAudio {
  return {
    level: features?.level ?? 0,
    kick: features?.gate ? Math.sqrt(Math.min(1, rangePeak(features.spectrum, SAMPLE_RATE, features.spectrum.length * 2, 60, 150) * features.gain)) : 0,
    beat: features?.beat ?? false,
    bands: Float32Array.from(features?.bands ?? new Float32Array(DEFAULT_ANALYSIS.bands)),
    chroma: Float32Array.from(features?.chroma ?? new Float32Array(12)),
  }
}

/** Loads and compiles but disappoints: nodes stacked on each other (boxes from the editor's 20 px rows) */
function listWarnings(doc: NodeGraph): string[] {
  const boxes = doc.nodes.flatMap((stored) => {
    const shape = readStoredShape(stored.data)
    if (!shape) return []
    const rows =
      shape.outputs.length +
      shape.inputs.reduce((sum, socket) => sum + (Array.isArray(socket.default) && socket.type.id !== 'color' ? 1 + socket.default.length : 1), 0)
    return [{ id: stored.id, x: stored.position.x, y: stored.position.y, w: 200, h: 34 + 22 * rows }]
  })
  return boxes.flatMap((a, i) =>
    boxes
      .slice(i + 1)
      .filter((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
      .map((b) => `"${a.id}" and "${b.id}" probably overlap in the editor`),
  )
}
