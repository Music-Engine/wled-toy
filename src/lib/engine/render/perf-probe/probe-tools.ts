import { expect } from 'vitest'
import { commands } from 'vitest/browser'
import { createGlslCompiler } from '@/lib/graph'
import { readGraphFile } from '@/lib/graph/model/file'
import { ShaderRenderer } from '@/lib/engine/render/renderer'

export const FRAMES = Number(import.meta.env.VITE_PERF_GPU_FRAMES ?? 120)
export const WARMUP = 20

const files = {
  ...import.meta.glob('/graphs/*.wledgraph', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('/graphs/bench/*.wledgraph', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>
export const graphText = Object.fromEntries(Object.entries(files).map(([path, text]) => [path.split('/').pop()!.replace('.wledgraph', ''), text]))

const ALL_PREVIEW_SIZES: readonly (readonly [number, number])[] = [[480, 270], [960, 540], [1280, 720], [1920, 1080], [2560, 1440]]
// SwiftShader takes minutes per frame at the top sizes, so a run there caps the sweep
const MAX_PREVIEW_WIDTH = Number(import.meta.env.VITE_PERF_GPU_MAX_PREVIEW ?? 4096)
export const PREVIEW_SIZES = ALL_PREVIEW_SIZES.filter(([width]) => width <= MAX_PREVIEW_WIDTH)

export const roundToMicros = (value: number) => Math.round(value * 1000) / 1000

export function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  const mean = sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1)
  return { median: roundToMicros(at(0.5)), mean: roundToMicros(mean), p95: roundToMicros(at(0.95)), max: roundToMicros(sorted[sorted.length - 1] ?? 0), min: roundToMicros(sorted[0] ?? 0), samples: sorted.length }
}

/** performance.now() is clamped to 0.1 ms here; timing `calls` repetitions moves the quantum below what is measured */
export function timeBatched(calls: number, run: (i: number) => void): number {
  const t0 = performance.now()
  for (let i = 0; i < calls; i++) run(i)
  return (performance.now() - t0) / calls
}

/** Ms per call of `run` over WARMUP + `frames`, warmup dropped */
export function timeFrames(frames: number, run: (frame: number) => void): number[] {
  const samples: number[] = []
  for (let frame = 0; frame < WARMUP + frames; frame++) {
    const t0 = performance.now()
    run(frame)
    if (frame >= WARMUP) samples.push(performance.now() - t0)
  }
  return samples
}

export function createProbeContext(): { gl: WebGL2RenderingContext; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  const gl = canvas.getContext('webgl2')
  if (!gl) throw new Error('no webgl2')
  return { gl, canvas }
}

export function readEnvironment() {
  const { gl, canvas } = createProbeContext()
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const env = {
    webglRenderer: `${(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null) ?? gl.getParameter(gl.RENDERER)} | ${gl.getParameter(gl.VERSION)}`,
    vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : null,
    colorBufferFloat: !!gl.getExtension('EXT_color_buffer_float'),
    parallelShaderCompile: !!gl.getExtension('KHR_parallel_shader_compile'),
    maxCompletionThreads: gl.getExtension('KHR_parallel_shader_compile') ? gl.getParameter(0x91b0) : null,
    devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency,
    performanceNowQuantum: measureNowQuantum(),
    userAgent: navigator.userAgent,
  }
  canvas.remove()
  return env
}

/** Smallest non-zero performance.now() step: the clamp the harness works around */
function measureNowQuantum(): number {
  let smallest = Infinity
  for (let i = 0; i < 20000; i++) {
    const a = performance.now()
    const b = performance.now()
    if (b > a) smallest = Math.min(smallest, b - a)
  }
  return roundToMicros(smallest)
}

export function compilePixelPass(text: string): string {
  const { doc, problems } = readGraphFile(text)
  expect(problems).toEqual([])
  const { program, issues } = createGlslCompiler().compile(doc)
  expect(program, issues.map((issue) => issue.message).join('; ')).not.toBeNull()
  return program!.pixel
}

/** Preview on a `width` x `height` canvas; `after` times more on the same renderer. Returns canvas size key and stats */
export function timePreview(code: string, [width, height]: readonly [number, number], after?: (renderer: ShaderRenderer) => Record<string, unknown>) {
  const canvas = document.createElement('canvas')
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  document.body.appendChild(canvas)
  const renderer = new ShaderRenderer(canvas)
  renderer.compile(code)
  const gl = canvas.getContext('webgl2')!
  const pixel = new Uint8Array(4)
  const preview = summarize(timeFrames(60, (frame) => {
    renderer.renderPreview({ time: frame / 60, dt: 1 / 60, frame, ledCount: 60, scanY: 0.5 })
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    gl.finish()
  }))
  const extra = after?.(renderer)
  const size = `${canvas.width}x${canvas.height}`
  renderer.dispose()
  canvas.remove()
  return { size, preview, ...extra }
}

export const writeReport = (name: string, value: unknown) => commands.writeFile(`.work/perf/gpu/${name}.json`, JSON.stringify(value, null, 1))
