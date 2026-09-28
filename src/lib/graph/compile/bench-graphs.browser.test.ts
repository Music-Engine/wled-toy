// Timing harness for graphs/*.wledgraph and graphs/bench/*.wledgraph. Skipped unless VITE_GRAPH_BENCH=1; run it with
// scripts/bench-graph.sh. It mirrors the engine's LED tick the way demo-graphs.browser.test.ts does, but times each
// stage instead of looking at the pixels.
import { describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { layoutPositions } from '@/lib/engine/output/layout'
import { ShaderRenderer } from '@/lib/engine/render/renderer'
import { Runtime } from '@/lib/engine/runtime'
import { createGlslCompiler } from '@/lib/graph/compile/next/compilers'
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

/** The graphics adapter the numbers came from, so SwiftShader results are never read as hardware results. */
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

function runBenchmark(name: string, text: string) {
  const readTimes: number[] = []
  for (let i = 0; i < WARMUP + COMPILES; i++) {
    const t0 = performance.now()
    readGraphFile(text)
    if (i >= WARMUP) readTimes.push(performance.now() - t0)
  }
  const { doc, problems } = readGraphFile(text)
  expect(problems, `${name}: structural problems`).toEqual([])

  const compileTimes: number[] = []
  let compiled = createGlslCompiler().compile(doc)
  for (let i = 0; i < WARMUP + COMPILES; i++) {
    const t0 = performance.now()
    compiled = createGlslCompiler().compile(doc)
    if (i >= WARMUP) compileTimes.push(performance.now() - t0)
  }
  const { program, slots: table } = compiled
  expect(compiled.issues.map((issue) => `${issue.nodeId}: ${issue.message}`), `${name}: graph issues`).toEqual([])
  const code = `${program!.frame?.code ?? ''}${program!.pixel}`

  const glCompile: number[] = []
  const glWall: number[] = []
  const firstDraw: number[] = []
  for (let i = 0; i < 3; i++) {
    const renderer = new ShaderRenderer(document.createElement('canvas'))
    const probe = new Runtime(renderer)
    const t0 = performance.now()
    const reported = probe.load(program!, table)!
    glWall.push(performance.now() - t0)
    glCompile.push(reported)
    // some drivers only finish the compile when the program is first used, so the first draw is timed on its own
    const t1 = performance.now()
    probe.tick({ time: 0, dt: 1 / FPS, frame: 0, ledCount: 60, scanY: 0.5 })
    firstDraw.push(performance.now() - t1)
    renderer.dispose()
  }

  const runtimes = TARGETS.map((target) => {
    const renderer = new ShaderRenderer(document.createElement('canvas'))
    const runtime = new Runtime(renderer)
    runtime.load(program!, table)
    if (target.layout) renderer.setLayout(layoutPositions({ segments: [{ kind: 'matrix', width: target.layout, height: target.layout, serpentine: false, origin: 'top-left' }] }))
    return { renderer, runtime }
  })
  const canvas = previewCanvas()
  const previewRenderer = new ShaderRenderer(canvas)
  const preview = new Runtime(previewRenderer)
  preview.load(program!, table)
  const previewGl = canvas.getContext('webgl2')
  const previewPixel = new Uint8Array(4)
  // gl.finish() alone returns before SwiftShader has drawn; a one-pixel readback is a sync point that cannot be deferred
  const finishPreview = () => {
    previewGl?.readPixels(0, 0, 1, 1, previewGl.RGBA, previewGl.UNSIGNED_BYTE, previewPixel)
    previewGl?.finish()
  }

  const track = synthTrack(Math.ceil(FRAMES / FPS) + 1)
  const slots = openSlots(program!, SAMPLE_RATE)
  const extraTextures = slots.slice(1).map((slot) => slot.textures)

  const analysis: number[] = []
  const perHop: number[] = []
  const feed: number[] = []
  const renderPreview: number[] = []
  const tick: Record<string, number[]> = Object.fromEntries(TARGETS.map((t) => [t.name, []]))

  const primary = runtimes[0].runtime
  let heapStart = 0
  for (let frame = 0; frame < WARMUP + FRAMES; frame++) {
    const measured = frame >= WARMUP
    if (frame === WARMUP) heapStart = heapUsed() ?? 0
    const time = frame / FPS

    const t0 = performance.now()
    const { analyses, hops } = feedSlots(slots, track, time, SAMPLE_RATE)
    const analysisMs = performance.now() - t0
    const f = analyses[0]

    const t3 = performance.now()
    if (f) primary.feed(slots[0].textures, extraTextures, f)
    const feedMs = performance.now() - t3

    for (const other of [...runtimes.slice(1).map((r) => r.runtime), preview]) {
      if (f) other.feed(slots[0].textures, extraTextures, f)
    }

    const t4 = performance.now()
    preview.preview({ time, dt: 1 / FPS, frame, ledCount: 60, scanY: 0.5 }, 0)
    // the preview draws to the canvas and never reads back, so nothing would be waited on without this
    finishPreview()
    const previewMs = performance.now() - t4

    const params = { time, dt: 1 / FPS, frame, scanY: 0.5 }
    TARGETS.forEach((target, i) => {
      if (measured && frame >= WARMUP + TARGET_FRAMES && i > 0) return
      const t5 = performance.now()
      const leds = runtimes[i].runtime.tick({ ...params, ledCount: target.leds })
      const ms = performance.now() - t5
      if (measured) tick[target.name].push(ms)
      if (frame === WARMUP) expect(leds.some(Number.isNaN), `${name}: NaN in the LED colors at ${target.name}`).toBe(false)
    })

    if (measured) {
      analysis.push(analysisMs)
      perHop.push(hops > 0 ? analysisMs / hops : 0)
      feed.push(feedMs)
      renderPreview.push(previewMs)
    }
  }
  const heapEnd = heapUsed()

  // the stages whose per-frame numbers sit under the 0.1 ms clock quantum, measured again over a batch
  const [knob] = program!.uniforms
  const batchedSet = batched(BATCH, () => knob && primary.set(knob, 0.5))
  const batchedFeed = batched(BATCH, () => primary.feed(slots[0].textures, extraTextures, null))
  const batchedTick = Object.fromEntries(TARGETS.map((t, i) => [t.name, batched(BATCH, () => { runtimes[i].runtime.tick({ time: 0, dt: 1 / FPS, frame: 0, ledCount: t.leds, scanY: 0.5 }) })]))

  for (const { renderer } of runtimes) renderer.dispose()
  previewRenderer.dispose()
  canvas.remove()

  return {
    graph: name,
    webglRenderer: rendererString(),
    frames: FRAMES,
    targetFrames: TARGET_FRAMES,
    fps: FPS,
    nodes: doc.nodes.length,
    edges: doc.edges.length,
    glslChars: code.length,
    glslLines: code.split('\n').length,
    globalTexels: program!.frame?.texels ?? 0,
    uniforms: program!.uniforms.length,
    analysisSlots: slots.length,
    previewPixels: [canvas.width, canvas.height],
    usesFeedback: /\b(iPrevFrame|previousFrame)\b/.test(program!.pixel),
    compile: {
      readGraphFile: timing(readTimes),
      compile: timing(compileTimes),
      shaderCompileReported: timing(glCompile),
      shaderCompileWall: timing(glWall),
      firstRenderAfterCompile: timing(firstDraw),
    },
    frame: {
      audioAnalysis: timing(analysis),
      audioAnalysisPerHop: timing(perHop),
      feed: timing(feed),
      renderPreview: timing(renderPreview),
      tick: Object.fromEntries(TARGETS.map((t) => [t.name, timing(tick[t.name])])),
    },
    // one call's cost from a batch of BATCH, for the stages the 0.1 ms clock quantum cannot resolve one at a time
    frameBatched: {
      calls: BATCH,
      set: batchedSet,
      feed: batchedFeed,
      tick: batchedTick,
    },
    heap: heapStart && heapEnd
      ? { startBytes: heapStart, endBytes: heapEnd, growthBytes: heapEnd - heapStart, bytesPerFrame: Math.round((heapEnd - heapStart) / FRAMES) }
      : null,
  }
}

type Result = ReturnType<typeof runBenchmark>

function formatSummaryTable(results: Result[]): string {
  const sumFrameTotal = (r: Result) => r.frame.audioAnalysis.median + r.frame.feed.median + r.frame.tick['strip-300'].median
  const sorted = [...results].sort((a, b) => sumFrameTotal(b) - sumFrameTotal(a))
  const header = ['graph', 'nodes', 'GLSL lines', 'global texels', 'compile', 'GL compile', 'analysis', 'feed', 'feed (batched)', 'tick 300', 'tick 300 (batched)', 'tick 4096', 'preview', 'frame total']
  const rows = sorted.map((r) => [
    r.graph, String(r.nodes), String(r.glslLines), String(r.globalTexels),
    r.compile.compile.median.toFixed(2), r.compile.shaderCompileWall.median.toFixed(1),
    r.frame.audioAnalysis.median.toFixed(2), r.frame.feed.median.toFixed(3), r.frameBatched.feed.toFixed(3),
    r.frame.tick['strip-300'].median.toFixed(2), r.frameBatched.tick['strip-300'].toFixed(3), r.frame.tick['matrix-64x64'].median.toFixed(2),
    r.frame.renderPreview.median.toFixed(2), sumFrameTotal(r).toFixed(2),
  ])
  const table = [header, header.map(() => '---'), ...rows].map((cells) => `| ${cells.join(' | ')} |`).join('\n')
  return [
    '# Graph benchmarks',
    '',
    `WebGL renderer: \`${results[0]?.webglRenderer ?? 'unknown'}\``,
    '',
    `All figures are medians in ms. ${FRAMES} frames per graph at ${FPS} fps, ${TARGET_FRAMES} of them at the LED targets other than strip 60. A tick is the frame pass, the LED pass and the probe readback. Sorted by frame total (analysis + feed + tick 300).`,
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
    const result = runBenchmark(name, text)
    results.push(result)
    await commands.writeFile(`.work/bench/${name}.json`, JSON.stringify(result, null, 1))
  }, 900_000)

  it('writes the summary', async () => {
    expect(results.length).toBeGreaterThan(0)
    await commands.writeFile('.work/bench/summary.md', formatSummaryTable(results))
  })
})
