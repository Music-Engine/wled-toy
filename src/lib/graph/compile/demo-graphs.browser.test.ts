import { describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { rangePeak } from '@/lib/audio/dsp'
import { DEFAULT_ANALYSIS } from '@/lib/audio/service'
import { layoutPositions } from '@/lib/engine/layout'
import { ShaderRenderer } from '@/lib/engine/renderer'
import { generateGlsl } from './compile'
import { FrameRunner } from './frame'
import type { NodeGraph } from '@/lib/graph/model/doc'
import { readGraphFile } from '@/lib/graph/model/file'
import { storedShape } from '@/lib/graph/registry'
import { graph, node } from '@/lib/graph/testing'
import { BEAT, BREAKDOWN, FPS, SAMPLE_RATE, SECONDS, feedSlots, openSlots, section, synthTrack } from '@/lib/graph/testing/offline'

const PREVIEW = import.meta.env.VITE_GRAPH_PREVIEW === '1'
const ONLY = import.meta.env.VITE_GRAPH_ONLY as string | undefined
const STRIP_LEDS = PREVIEW ? 120 : 60
const MATRIX_SIDE = PREVIEW ? 32 : 8

const files = import.meta.glob('/graphs/*.wledgraph', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const graphs = Object.entries(files).map(([path, text]) => [path.split('/').pop()!.replace('.wledgraph', ''), text] as const)

/** Things that load and compile but will disappoint: nodes stacked on each other (boxes estimated from the editor's 20 px rows). */
function warnings(doc: NodeGraph): string[] {
  const boxes = doc.nodes.flatMap((node) => {
    const shape = storedShape(node.data)
    if (!shape) return []
    const rows = shape.outputs.length + shape.inputs.reduce((sum, s) => sum + (Array.isArray(s.default) && s.type.id !== 'color' ? 1 + s.default.length : 1), 0)
    return [{ id: node.id, x: node.position.x, y: node.position.y, w: 200, h: 34 + 22 * rows }]
  })
  return boxes.flatMap((a, i) => boxes.slice(i + 1)
    .filter((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
    .map((b) => `"${a.id}" and "${b.id}" probably overlap in the editor`))
}

interface FrameAudio {
  level: number
  kick: number
  /** The analyzer raised `beat` on some hop since the previous frame, which is what the frame bodies see. */
  beat: boolean
  bands: Float32Array
  chroma: Float32Array
}

interface Run {
  strip: Float32Array[]
  matrix: Float32Array[]
  audio: FrameAudio[]
}

/** The engine's LED tick, offline: hops up to the frame's time are analyzed, then controls step, audio uploads, LEDs render. */
function play(doc: NodeGraph, track: Float32Array): Run {
  const shader = generateGlsl(doc)
  expect(shader.error, `graph error at node "${shader.errorNode}": ${shader.error}`).toBeNull()
  expect(shader.issues.map((issue) => `${issue.nodeId}: ${issue.message}`), 'graph issues').toEqual([])

  const [strip, matrix] = [0, 1].map(() => new ShaderRenderer(document.createElement('canvas')))
  try {
    strip.compile(shader.code)
    matrix.compile(shader.code)
  } catch (e) {
    const message = (e as Error).message
    const line = Number(/ERROR: \d+:(\d+)/.exec(message)?.[1])
    throw new Error(`GLSL compile error at node "${shader.lineNodes[line] ?? 'unknown'}": ${message}\n${shader.code}`)
  }
  matrix.setLayout(layoutPositions({ segments: [{ kind: 'matrix', width: MATRIX_SIDE, height: MATRIX_SIDE, serpentine: false, origin: 'top-left' }] }))

  const runner = new FrameRunner()
  runner.load(shader.frame)
  const slots = openSlots(shader.frame, SAMPLE_RATE)

  const run: Run = { strip: [], matrix: [], audio: [] }
  for (let frame = 0; frame < SECONDS * FPS; frame++) {
    const time = frame / FPS
    const { analyses } = feedSlots(slots, track, time, SAMPLE_RATE)
    const f = analyses[0]
    run.audio.push({
      level: f?.level ?? 0,
      kick: f?.gate ? Math.sqrt(Math.min(1, rangePeak(f.spectrum, SAMPLE_RATE, f.spectrum.length * 2, 60, 150) * f.gain)) : 0,
      beat: f?.beat ?? false,
      bands: Float32Array.from(f?.bands ?? new Float32Array(DEFAULT_ANALYSIS.bands)),
      chroma: Float32Array.from(f?.chroma ?? new Float32Array(12)),
    })

    const controls = runner.step({ time, dt: 1 / FPS, frameIndex: frame, audio: f ? { analyses, sampleRate: SAMPLE_RATE } : undefined })
    for (const renderer of [strip, matrix]) {
      renderer.setControls(controls)
      if (f) renderer.setAudio(slots[0].textures, slots.slice(1).map((slot) => slot.textures))
    }
    run.strip.push(strip.renderLeds({ time, dt: 1 / FPS, frame, ledCount: STRIP_LEDS, scanY: 0.5 }))
    run.matrix.push(matrix.renderLeds({ time, dt: 1 / FPS, frame, ledCount: MATRIX_SIDE * MATRIX_SIDE, scanY: 0.5 }))
  }
  strip.dispose()
  matrix.dispose()
  return run
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)
const round = (value: number) => Math.round(value * 1000) / 1000

/** Pearson correlation of `a` against `b` delayed by `lag` frames; 0 when either is constant. */
function correlation(a: number[], b: number[], lag = 0): number {
  const x = a.slice(lag)
  const y = b.slice(0, b.length - lag)
  const [mx, my] = [mean(x), mean(y)]
  const cov = mean(x.map((v, i) => (v - mx) * (y[i] - my)))
  const spread = Math.sqrt(mean(x.map((v) => (v - mx) ** 2)) * mean(y.map((v) => (v - my) ** 2)))
  return spread < 1e-9 ? 0 : cov / spread
}

function summarize(frames: Float32Array[]) {
  const brightness = frames.map((leds) => mean([...leds].map((c) => Math.min(1, Math.max(0, c)))))
  const delta = frames.map((leds, i) => (i === 0 ? 0 : mean([...leds].map((c, k) => Math.abs(c - frames[i - 1][k])))))
  let black = 0
  let white = 0
  for (const leds of frames) {
    for (let i = 0; i < leds.length; i += 3) {
      if (Math.max(leds[i], leds[i + 1], leds[i + 2]) < 0.02) black++
      if (Math.min(leds[i], leds[i + 1], leds[i + 2]) > 0.98) white++
    }
  }
  const ledSamples = frames.length * frames[0].length / 3
  return { brightness, delta, blackFraction: black / ledSamples, whiteFraction: white / ledSamples }
}

function stats(run: Run, notes: string[]) {
  const strip = summarize(run.strip)
  const matrix = summarize(run.matrix)
  const times = run.audio.map((_, frame) => frame / FPS)
  const bestLag = (signal: number[]) => {
    const byLag = Array.from({ length: 7 }, (_, lag) => correlation(strip.brightness, signal, lag))
    const lag = byLag.indexOf(Math.max(...byLag))
    return { atLag0: round(byLag[0]), best: round(byLag[lag]), bestLagFrames: lag }
  }
  return {
    fps: FPS,
    frames: run.strip.length,
    stripLeds: STRIP_LEDS,
    matrix: `${MATRIX_SIDE}x${MATRIX_SIDE}`,
    sections: { groove: [0, BREAKDOWN[0]], breakdown: BREAKDOWN, drop: [BREAKDOWN[1], SECONDS] },
    summary: {
      meanBrightness: round(mean(strip.brightness)),
      minBrightness: round(Math.min(...strip.brightness)),
      maxBrightness: round(Math.max(...strip.brightness)),
      meanBrightnessBySection: Object.fromEntries(['groove', 'breakdown', 'drop'].map((name) => [name, round(mean(strip.brightness.filter((_, i) => section(times[i]) === name)))])),
      meanFrameDelta: round(mean(strip.delta)),
      blackLedFraction: round(strip.blackFraction),
      whiteLedFraction: round(strip.whiteFraction),
      brightnessVsLevel: bestLag(run.audio.map((a) => a.level)),
      brightnessVsKick: bestLag(run.audio.map((a) => a.kick)),
      matrixMeanBrightness: round(mean(matrix.brightness)),
      matrixBlackLedFraction: round(matrix.blackFraction),
      matrixWhiteLedFraction: round(matrix.whiteFraction),
      beatsDetected: run.audio.filter((a) => a.beat).length,
    },
    warnings: notes,
    perFrame: {
      time: times.map(round),
      brightness: strip.brightness.map(round),
      delta: strip.delta.map(round),
      audioLevel: run.audio.map((a) => round(a.level)),
      audioKick: run.audio.map((a) => round(a.kick)),
    },
  }
}

/** `leds` is r, g, b floats per LED, laid out `width` to a row from the top left. */
function ledImage(leds: Float32Array, width: number): HTMLCanvasElement {
  const canvas = Object.assign(document.createElement('canvas'), { width, height: leds.length / 3 / width })
  const image = new ImageData(canvas.width, canvas.height)
  for (let i = 0; i < leds.length / 3; i++) {
    for (let c = 0; c < 3; c++) image.data[i * 4 + c] = Math.round(Math.min(1, Math.max(0, leds[i * 3 + c])) * 255)
    image.data[i * 4 + 3] = 255
  }
  canvas.getContext('2d')!.putImageData(image, 0, 0)
  return canvas
}

function sheet(width: number, height: number) {
  const canvas = Object.assign(document.createElement('canvas'), { width, height })
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#181818'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingEnabled = false
  ctx.font = '11px monospace'
  ctx.textBaseline = 'top'
  return { canvas, ctx }
}

/** One row per frame, time running downward, with the music in a gutter on the left so rows can be matched to it. */
function timeline(run: Run, rows: Float32Array[], caption: string): HTMLCanvasElement {
  const [left, top, rowHeight] = [160, 30, 3]
  const columns = rows[0].length / 3
  const cell = Math.round(720 / columns)
  const { canvas, ctx } = sheet(left + columns * cell, top + rows.length * rowHeight)
  ctx.fillStyle = '#ddd'
  ctx.fillText(caption, left, 2)
  ctx.fillText('time', 0, 16)
  ctx.fillText('kick', 56, 16)
  ctx.fillText('level', 90, 16)
  ctx.fillText('beat', 128, 16)

  const all = new Float32Array(rows.length * columns * 3)
  rows.forEach((row, frame) => all.set(row, frame * columns * 3))
  ctx.drawImage(ledImage(all, columns), left, top, columns * cell, rows.length * rowHeight)

  run.audio.forEach((audio, frame) => {
    const t = frame / FPS
    const y = top + frame * rowHeight
    const bar = (x: number, width: number, color: string) => {
      ctx.fillStyle = color
      ctx.fillRect(x, y, width, rowHeight)
    }
    if (frame % FPS === 0) {
      ctx.fillStyle = '#ddd'
      ctx.fillText(`${t}s`, 0, y)
    }
    bar(30, 8, { groove: '#555', breakdown: '#2060ff', drop: '#ff30a0' }[section(t)])
    if (section(t) !== 'breakdown' && t % BEAT < 1.5 / FPS) bar(42, 8, Math.floor(t / BEAT) % 2 === 1 ? '#30e0ff' : '#ff9020')
    bar(56, Math.round(audio.kick * 30), '#e03030')
    bar(90, Math.round(audio.level * 30), '#30c040')
    if (audio.beat) bar(134, 10, '#fff')
  })
  return canvas
}

function matrixSheet(run: Run): HTMLCanvasElement {
  const [columns, scale, label, gap] = [4, 5, 14, 8]
  const tile = MATRIX_SIDE * scale
  const { canvas, ctx } = sheet(gap + columns * (tile + gap), gap + 4 * (tile + label + gap))
  Array.from({ length: 16 }, (_, i) => Math.round((0.57 + i * 0.6) * FPS)).forEach((frame, i) => {
    const t = frame / FPS
    const x = gap + (i % columns) * (tile + gap)
    const y = gap + Math.floor(i / columns) * (tile + label + gap)
    const note = section(t) === 'breakdown' ? 'breakdown' : `${section(t)}${t % BEAT < 0.1 ? ' KICK' : ''}`
    ctx.fillStyle = '#ddd'
    ctx.fillText(`${t.toFixed(2)}s ${note}`, x, y)
    ctx.drawImage(ledImage(run.matrix[frame], MATRIX_SIDE), x, y + label, tile, tile)
  })
  return canvas
}

const writePng = (path: string, canvas: HTMLCanvasElement) => commands.writeFile(path, canvas.toDataURL('image/png').split(',')[1], 'base64')

describe('demo graphs', () => {
  const track = synthTrack()

  it('finds the graphs it is meant to check', () => {
    expect(graphs.filter(([name]) => !ONLY || name === ONLY)).not.toEqual([])
  })

  it.each(graphs.filter(([name]) => !ONLY || name === ONLY))('%s is valid, renders and reacts to music', async (name, text) => {
    const { doc, problems } = readGraphFile(text)
    expect(problems, 'structural problems').toEqual([])

    const run = play(doc, track)
    expect(run.strip.some((leds) => leds.some(Number.isNaN)), 'NaN in the LED colors').toBe(false)
    expect(run.strip.some((leds) => leds.some((c) => c > 0.02)), 'every LED is black for the whole run').toBe(true)
    expect(run.strip.some((leds) => leds.some((c, i) => Math.abs(c - run.strip[0][i]) > 0.02)), 'the output never changes over time').toBe(true)

    if (!PREVIEW) return
    const dir = `.work/graph-previews/${name}`
    await writePng(`${dir}/strip-timeline.png`, timeline(run, run.strip, `x: LED 0 (uv.x = 0) to LED ${STRIP_LEDS - 1}, y: time running downward, ${FPS} rows per second`))
    await writePng(`${dir}/matrix-sheet.png`, matrixSheet(run))
    await commands.writeFile(`${dir}/stats.json`, JSON.stringify(stats(run, warnings(doc)), null, 1))
  }, 300_000)

  it.runIf(PREVIEW)('draws what the analyzer hears in the test track', async () => {
    const run = play(graph([node('o', 'output')]), track)
    const grey = (levels: Float32Array) => [...levels].flatMap((v) => [v, v, v])
    const rows = run.audio.map((audio) => Float32Array.from([...grey(audio.bands), 0, 0.2, 0, ...grey(audio.chroma)]))
    await writePng('.work/graph-previews/track.png', timeline(run, rows, 'x: the 64 default FFT bands, 40 Hz to 16 kHz (mel), then the 12 pitch classes C to B; y: time'))
  }, 300_000)
})
