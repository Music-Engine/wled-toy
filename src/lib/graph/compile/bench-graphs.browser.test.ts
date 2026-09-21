// Timing harness for graphs/*.wledgraph and graphs/bench/*.wledgraph. Skipped unless VITE_GRAPH_BENCH=1; run it with
// scripts/bench-graph.sh. It mirrors the engine's LED tick the way demo-graphs.browser.test.ts does, but times each
// stage instead of looking at the pixels.
import { describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { layoutPositions } from '@/lib/engine/layout'
import { ShaderRenderer } from '@/lib/engine/renderer'
import { generateGlsl } from './compile'
import { ControlRunner } from './control'
import { readGraphFile } from '@/lib/graph/model/file'
import { FPS, SAMPLE_RATE, feedSlots, openSlots, synthTrack } from '@/lib/graph/testing/offline'

const BENCH = import.meta.env.VITE_GRAPH_BENCH === '1'
const ONLY = import.meta.env.VITE_GRAPH_ONLY as string | undefined
const FRAMES = Number(import.meta.env.VITE_GRAPH_BENCH_FRAMES ?? 300)
const TARGET_FRAMES = Number(import.meta.env.VITE_GRAPH_BENCH_TARGET_FRAMES ?? 60)
const WARMUP = 10
const COMPILES = 20
const PREVIEW_SIZE = [480, 270]

const files = {
  ...import.meta.glob('/graphs/*.wledgraph', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('/graphs/bench/*.wledgraph', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>
const graphs = Object.entries(files)
  .map(([path, text]) => [path.split('/').pop()!.replace('.wledgraph', ''), text] as const)
  .sort(([a], [b]) => a.localeCompare(b))

const TARGETS = [
  { name: 'strip-60', leds: 60, layout: null },
  { name: 'strip-300', leds: 300, layout: null },
  { name: 'strip-1000', leds: 1000, layout: null },
  { name: 'matrix-16x16', leds: 256, layout: 16 },
  { name: 'matrix-32x32', leds: 1024, layout: 32 },
  { name: 'matrix-64x64', leds: 4096, layout: 64 },
] as const

interface Timing {
  median: number
  p95: number
  max: number
  samples: number
}

const round = (value: number) => Math.round(value * 1000) / 1000

/** How many repeats the sub-0.1 ms stages are timed in; see `batched`. */
const BATCH = 500

/**
 * `performance.now()` is clamped to 0.1 ms in this page, so a stage that costs less reads as 0 or 0.1.
 * Timing `calls` repeats of it and dividing puts the quantum below the thing being measured. The stages timed
 * this way are the ones whose per-frame figures quantize to 0; the repeats run on the same frame's inputs, so a
 * stateful stage advances its state `calls` times instead of once.
 */
function batched(calls: number, fn: () => void): number {
  const t0 = performance.now()
  for (let i = 0; i < calls; i++) fn()
  return round((performance.now() - t0) / calls)
}

function timing(values: number[]): Timing {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  return { median: round(at(0.5)), p95: round(at(0.95)), max: round(sorted[sorted.length - 1] ?? 0), samples: sorted.length }
}

/** The GPU the numbers came from, so SwiftShader results are never read as hardware results. */
function rendererString(): string {
  const gl = document.createElement('canvas').getContext('webgl2')
  if (!gl) return 'no webgl2'
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const unmasked = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null
  return `${unmasked ?? gl.getParameter(gl.RENDERER)} | ${gl.getParameter(gl.VERSION)}`
}

const heapUsed = () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize

/** A canvas in the page, so renderPreview has a real size instead of the 0x0 an unattached one reports. */
function previewCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.style.width = `${PREVIEW_SIZE[0]}px`
  canvas.style.height = `${PREVIEW_SIZE[1]}px`
  document.body.appendChild(canvas)
  return canvas
}

function benchmark(name: string, text: string) {
  const readTimes: number[] = []
  for (let i = 0; i < WARMUP + COMPILES; i++) {
    const t0 = performance.now()
    readGraphFile(text)
    if (i >= WARMUP) readTimes.push(performance.now() - t0)
  }
  const { doc, problems } = readGraphFile(text)
  expect(problems, `${name}: structural problems`).toEqual([])

  const generateTimes: number[] = []
  let shader = generateGlsl(doc)
  for (let i = 0; i < WARMUP + COMPILES; i++) {
    const t0 = performance.now()
    shader = generateGlsl(doc)
    if (i >= WARMUP) generateTimes.push(performance.now() - t0)
  }
  expect(shader.error, `${name}: graph error at node "${shader.errorNode}"`).toBeNull()
  expect(shader.issues.map((issue) => `${issue.nodeId}: ${issue.message}`), `${name}: graph issues`).toEqual([])

  const glCompile: number[] = []
  const glWall: number[] = []
  const firstDraw: number[] = []
  for (let i = 0; i < 3; i++) {
    const probe = new ShaderRenderer(document.createElement('canvas'))
    const t0 = performance.now()
    const reported = probe.compile(shader.code)
    glWall.push(performance.now() - t0)
    glCompile.push(reported)
    // some drivers only finish the compile when the program is first used, so the first draw is timed on its own
    const t1 = performance.now()
    probe.renderLeds({ time: 0, dt: 1 / FPS, frame: 0, ledCount: 60, scanY: 0.5 })
    firstDraw.push(performance.now() - t1)
    probe.dispose()
  }

  const renderers = TARGETS.map((target) => {
    const renderer = new ShaderRenderer(document.createElement('canvas'))
    renderer.compile(shader.code)
    if (target.layout) renderer.setLayout(layoutPositions({ segments: [{ kind: 'matrix', width: target.layout, height: target.layout, serpentine: false, origin: 'top-left' }] }))
    return renderer
  })
  const canvas = previewCanvas()
  const preview = new ShaderRenderer(canvas)
  preview.compile(shader.code)
  const previewGl = canvas.getContext('webgl2')
  const previewPixel = new Uint8Array(4)
  // gl.finish() alone returns before SwiftShader has drawn; a one-pixel readback is a sync point that cannot be deferred
  const finishPreview = () => {
    previewGl?.readPixels(0, 0, 1, 1, previewGl.RGBA, previewGl.UNSIGNED_BYTE, previewPixel)
    previewGl?.finish()
  }

  const runner = new ControlRunner()
  runner.load(shader.control)
  const track = synthTrack(Math.ceil(FRAMES / FPS) + 1)
  const slots = openSlots(shader.control, SAMPLE_RATE)

  const analysis: number[] = []
  const perHop: number[] = []
  const step: number[] = []
  const setControls: number[] = []
  const setAudio: number[] = []
  const renderPreview: number[] = []
  const renderLeds: Record<string, number[]> = Object.fromEntries(TARGETS.map((t) => [t.name, []]))

  const primary = renderers[0]
  let heapStart = 0
  for (let frame = 0; frame < WARMUP + FRAMES; frame++) {
    const measured = frame >= WARMUP
    if (frame === WARMUP) heapStart = heapUsed() ?? 0
    const time = frame / FPS

    const t0 = performance.now()
    const { analyses, hops } = feedSlots(slots, track, time, SAMPLE_RATE)
    const analysisMs = performance.now() - t0
    const f = analyses[0]

    const t1 = performance.now()
    const controls = runner.step({ time, dt: 1 / FPS, frame, audio: f ? { analyses, sampleRate: SAMPLE_RATE } : undefined })
    const stepMs = performance.now() - t1

    const t2 = performance.now()
    primary.setControls(controls)
    const setControlsMs = performance.now() - t2

    const t3 = performance.now()
    if (f) primary.setAudio(slots[0].textures, slots.slice(1).map((slot) => slot.textures))
    const setAudioMs = performance.now() - t3

    for (const other of [...renderers.slice(1), preview]) {
      other.setControls(controls)
      if (f) other.setAudio(slots[0].textures, slots.slice(1).map((slot) => slot.textures))
    }

    const t4 = performance.now()
    preview.renderPreview({ time, dt: 1 / FPS, frame, ledCount: 60, scanY: 0.5 })
    // renderPreview draws to the canvas and never reads back, so nothing would be waited on without this
    finishPreview()
    const previewMs = performance.now() - t4

    const params = { time, dt: 1 / FPS, frame, scanY: 0.5 }
    TARGETS.forEach((target, i) => {
      if (measured && frame >= WARMUP + TARGET_FRAMES && i > 0) return
      const t5 = performance.now()
      const leds = renderers[i].renderLeds({ ...params, ledCount: target.leds })
      const ms = performance.now() - t5
      if (measured) renderLeds[target.name].push(ms)
      if (frame === WARMUP) expect(leds.some(Number.isNaN), `${name}: NaN in the LED colors at ${target.name}`).toBe(false)
    })

    if (measured) {
      analysis.push(analysisMs)
      perHop.push(hops > 0 ? analysisMs / hops : 0)
      step.push(stepMs)
      setControls.push(setControlsMs)
      setAudio.push(setAudioMs)
      renderPreview.push(previewMs)
    }
  }
  const heapEnd = heapUsed()

  // the stages whose per-frame numbers sit under the 0.1 ms clock quantum, measured again over a batch
  const lastControls = runner.step({ time: FRAMES / FPS, dt: 1 / FPS, frame: FRAMES, audio: undefined })
  const batchedStep = batched(BATCH, () => { runner.step({ time: FRAMES / FPS, dt: 1 / FPS, frame: FRAMES, audio: undefined }) })
  const batchedSetControls = batched(BATCH, () => primary.setControls(lastControls))
  const extraTextures = slots.slice(1).map((slot) => slot.textures)
  const batchedSetAudio = batched(BATCH, () => primary.setAudio(slots[0].textures, extraTextures))
  const batchedRenderLeds = Object.fromEntries(TARGETS.map((t, i) => [t.name, batched(BATCH, () => { renderers[i].renderLeds({ time: 0, dt: 1 / FPS, frame: 0, ledCount: t.leds, scanY: 0.5 }) })]))

  for (const renderer of [...renderers, preview]) renderer.dispose()
  canvas.remove()

  const lines = shader.code.split('\n').length
  return {
    graph: name,
    webglRenderer: rendererString(),
    frames: FRAMES,
    targetFrames: TARGET_FRAMES,
    fps: FPS,
    nodes: doc.nodes.length,
    edges: doc.edges.length,
    glslChars: shader.code.length,
    glslLines: lines,
    controlSteps: shader.control.steps.length,
    controlExports: shader.control.exports.length,
    controlUniformFloats: shader.control.exports.reduce((sum, e) => sum + e.dim, 0),
    analysisSlots: slots.length,
    previewPixels: [canvas.width, canvas.height],
    usesFeedback: /\b(iPrevFrame|previousFrame)\b/.test(shader.code),
    compile: {
      readGraphFile: timing(readTimes),
      generateGlsl: timing(generateTimes),
      shaderCompileReported: timing(glCompile),
      shaderCompileWall: timing(glWall),
      firstRenderAfterCompile: timing(firstDraw),
    },
    frame: {
      audioAnalysis: timing(analysis),
      audioAnalysisPerHop: timing(perHop),
      runnerStep: timing(step),
      setControls: timing(setControls),
      setAudio: timing(setAudio),
      renderPreview: timing(renderPreview),
      renderLeds: Object.fromEntries(TARGETS.map((t) => [t.name, timing(renderLeds[t.name])])),
    },
    // one call's cost from a batch of BATCH, for the stages the 0.1 ms clock quantum cannot resolve one at a time
    frameBatched: {
      calls: BATCH,
      runnerStep: batchedStep,
      setControls: batchedSetControls,
      setAudio: batchedSetAudio,
      renderLeds: batchedRenderLeds,
    },
    heap: heapStart && heapEnd
      ? { startBytes: heapStart, endBytes: heapEnd, growthBytes: heapEnd - heapStart, bytesPerFrame: Math.round((heapEnd - heapStart) / FRAMES) }
      : null,
  }
}

type Result = ReturnType<typeof benchmark>

function summaryTable(results: Result[]): string {
  const total = (r: Result) => r.frame.audioAnalysis.median + r.frame.runnerStep.median + r.frame.setControls.median + r.frame.setAudio.median + r.frame.renderLeds['strip-300'].median
  const sorted = [...results].sort((a, b) => total(b) - total(a))
  const header = ['graph', 'nodes', 'GLSL lines', 'ctrl steps', 'generateGlsl', 'GL compile', 'analysis', 'step', 'step (batched)', 'setAudio', 'setAudio (batched)', 'LEDs 300', 'LEDs 4096', 'preview', 'frame total']
  const rows = sorted.map((r) => [
    r.graph, String(r.nodes), String(r.glslLines), String(r.controlSteps),
    r.compile.generateGlsl.median.toFixed(2), r.compile.shaderCompileWall.median.toFixed(1),
    r.frame.audioAnalysis.median.toFixed(2), r.frame.runnerStep.median.toFixed(3), r.frameBatched.runnerStep.toFixed(3),
    r.frame.setAudio.median.toFixed(3), r.frameBatched.setAudio.toFixed(3),
    r.frame.renderLeds['strip-300'].median.toFixed(2), r.frame.renderLeds['matrix-64x64'].median.toFixed(2),
    r.frame.renderPreview.median.toFixed(2), total(r).toFixed(2),
  ])
  const table = [header, header.map(() => '---'), ...rows].map((cells) => `| ${cells.join(' | ')} |`).join('\n')
  return [
    '# Graph benchmarks',
    '',
    `WebGL renderer: \`${results[0]?.webglRenderer ?? 'unknown'}\``,
    '',
    `All figures are medians in ms. ${FRAMES} frames per graph at ${FPS} fps, ${TARGET_FRAMES} of them at the LED targets other than strip 60. Sorted by frame total (analysis + step + setControls + setAudio + LEDs 300).`,
    '',
    table,
    '',
    `Per-graph detail, including p95 and max: \`.work/bench/<graph>.json\`.`,
    '',
  ].join('\n')
}

describe.runIf(BENCH)('graph benchmarks', () => {
  const results: Result[] = []
  const selected = graphs.filter(([name]) => !ONLY || name === ONLY)

  it('finds the graphs it is meant to measure', () => {
    expect(selected).not.toEqual([])
  })

  it.each(selected)('%s', async (name, text) => {
    const result = benchmark(name, text)
    results.push(result)
    await commands.writeFile(`.work/bench/${name}.json`, JSON.stringify(result, null, 1))
  }, 900_000)

  it('writes the summary', async () => {
    expect(results.length).toBeGreaterThan(0)
    await commands.writeFile('.work/bench/summary.md', summaryTable(results))
  })
})
