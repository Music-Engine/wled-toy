// GPU render path probe behind the render path's own numbers in graphs/bench/reports/profile-gpu.md.
// Skipped unless VITE_PERF_GPU=1; writes .work/perf/gpu/*.json. Run it with BENCH_GPU=1 for hardware numbers.
// It measures the render path around ShaderRenderer without changing it: a private probe context draws the same
// emitted GLSL so readback strategies can be compared on an identical draw.
import { describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { layoutPositions } from '@/lib/engine/layout'
import { ShaderRenderer } from '@/lib/engine/renderer'
import { PRELUDE } from '@/lib/shader/glsl'
import { generateGlsl } from '@/lib/graph/compile/compile'
import { readGraphFile } from '@/lib/graph/model/file'

const RUN = import.meta.env.VITE_PERF_GPU === '1'
const FRAMES = Number(import.meta.env.VITE_PERF_GPU_FRAMES ?? 120)
const WARMUP = 20

const files = {
  ...import.meta.glob('/graphs/*.wledgraph', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('/graphs/bench/*.wledgraph', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>
const graphText = Object.fromEntries(Object.entries(files).map(([path, text]) => [path.split('/').pop()!.replace('.wledgraph', ''), text]))

const VARIANTS = ['gpu-full', 'gpu-drop-noise', 'gpu-drop-voronoi', 'gpu-drop-magic', 'gpu-drop-brick', 'gpu-drop-wave', 'gpu-drop-ramp', 'gpu-drop-mix', 'gpu-drop-all']

const TARGETS = [
  { name: 'strip-60', leds: 60, layout: null },
  { name: 'strip-300', leds: 300, layout: null },
  { name: 'strip-1000', leds: 1000, layout: null },
  { name: 'matrix-16x16', leds: 256, layout: 16 },
  { name: 'matrix-32x32', leds: 1024, layout: 32 },
  { name: 'matrix-64x64', leds: 4096, layout: 64 },
] as const

const ALL_PREVIEW_SIZES: readonly (readonly [number, number])[] = [[480, 270], [960, 540], [1280, 720], [1920, 1080], [2560, 1440]]
// SwiftShader needs minutes per frame at the top sizes, so a run there caps the sweep
const MAX_PREVIEW_WIDTH = Number(import.meta.env.VITE_PERF_GPU_MAX_PREVIEW ?? 4096)
const PREVIEW_SIZES = ALL_PREVIEW_SIZES.filter(([w]) => w <= MAX_PREVIEW_WIDTH)

const round = (value: number) => Math.round(value * 1000) / 1000

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  const mean = sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1)
  return { median: round(at(0.5)), mean: round(mean), p95: round(at(0.95)), max: round(sorted[sorted.length - 1] ?? 0), min: round(sorted[0] ?? 0), samples: sorted.length }
}

/**
 * performance.now() is clamped to 0.1 ms in this page, so a single sub-0.1 ms call reads as 0 or 0.1.
 * Timing `calls` repetitions and dividing moves the quantum below the thing being measured.
 */
function batched(calls: number, fn: (i: number) => void): number {
  const t0 = performance.now()
  for (let i = 0; i < calls; i++) fn(i)
  return (performance.now() - t0) / calls
}

function context(): { gl: WebGL2RenderingContext; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  const gl = canvas.getContext('webgl2')
  if (!gl) throw new Error('no webgl2')
  return { gl, canvas }
}

function environment() {
  const { gl, canvas } = context()
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const env = {
    webglRenderer: `${(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null) ?? gl.getParameter(gl.RENDERER)} | ${gl.getParameter(gl.VERSION)}`,
    vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : null,
    colorBufferFloat: !!gl.getExtension('EXT_color_buffer_float'),
    parallelShaderCompile: !!gl.getExtension('KHR_parallel_shader_compile'),
    maxCompletionThreads: gl.getExtension('KHR_parallel_shader_compile') ? gl.getParameter(0x91b0) : null,
    devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency,
    performanceNowQuantum: nowQuantum(),
    userAgent: navigator.userAgent,
  }
  canvas.remove()
  return env
}

/** Smallest non-zero difference performance.now() reports, which is the clamp the harness has to work around. */
function nowQuantum(): number {
  let smallest = Infinity
  for (let i = 0; i < 20000; i++) {
    const a = performance.now()
    const b = performance.now()
    if (b > a) smallest = Math.min(smallest, b - a)
  }
  return round(smallest)
}

/**
 * A minimal renderer for the readback comparison: the same fragment program and the same one-pixel-per-LED
 * framebuffer as ShaderRenderer.renderLeds, with three readback strategies over an identical draw.
 */
class ReadbackProbe {
  private readonly program: WebGLProgram
  private readonly fb: WebGLFramebuffer
  private readonly tex: WebGLTexture
  private readonly pbos: [WebGLBuffer, WebGLBuffer]
  private readonly fences: (WebGLSync | null)[] = [null, null]
  private width = 0
  private slot = 0
  private floats = new Float32Array(0)
  private readonly uniforms: Record<string, WebGLUniformLocation | null>
  readonly floatTargets: boolean
  lateReads = 0
  reads = 0

  constructor(private readonly gl: WebGL2RenderingContext, code: string) {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.floatTargets = !!gl.getExtension('EXT_color_buffer_float')
    this.program = link(gl, PRELUDE + code)
    this.uniforms = Object.fromEntries(['iResolution', 'iTime', 'iFrame', 'iLedCount', 'iScanY', 'iTimeDelta', 'iLayoutCount'].map((n) => [n, gl.getUniformLocation(this.program, n)]))
    this.tex = gl.createTexture()
    this.fb = gl.createFramebuffer()
    this.pbos = [gl.createBuffer(), gl.createBuffer()]
  }

  resize(n: number) {
    if (this.width === n) return
    const { gl } = this
    this.width = n
    this.floats = new Float32Array(n * 4)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    if (this.floatTargets) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, n, 1, 0, gl.RGBA, gl.HALF_FLOAT, null)
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, n, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0)
    for (const pbo of this.pbos) {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo)
      gl.bufferData(gl.PIXEL_PACK_BUFFER, n * 4 * 4, gl.STREAM_READ)
    }
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  draw(n: number, frame: number) {
    const { gl, uniforms: u } = this
    this.resize(n)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb)
    gl.viewport(0, 0, n, 1)
    gl.useProgram(this.program)
    gl.uniform3f(u.iResolution ?? null, n, 1, 1)
    gl.uniform1f(u.iTime ?? null, frame / 60)
    gl.uniform1i(u.iFrame ?? null, frame)
    gl.uniform1f(u.iLedCount ?? null, n)
    gl.uniform1f(u.iScanY ?? null, 0.5)
    gl.uniform1f(u.iTimeDelta ?? null, 1 / 60)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  /** Mode a: what renderer.ts:258 does. */
  drawAndReadSync(n: number, frame: number) {
    this.draw(n, frame)
    const { gl } = this
    gl.readPixels(0, 0, n, 1, gl.RGBA, gl.FLOAT, this.floats)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /** Mode b: draw submission only, no readback, so the GPU is never waited on. */
  drawOnly(n: number, frame: number) {
    this.draw(n, frame)
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null)
  }

  /** Mode c: pack into a PBO behind a fence and collect the previous tick's PBO without ever blocking. */
  drawAndReadAsync(n: number, frame: number) {
    const { gl } = this
    const previous = this.slot
    const next = this.slot ^ 1
    this.draw(n, frame)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbos[next])
    gl.readPixels(0, 0, n, 1, gl.RGBA, gl.FLOAT, 0)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.fences[next] = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)
    gl.flush()
    const fence = this.fences[previous]
    if (fence) {
      this.reads++
      if (gl.clientWaitSync(fence, gl.SYNC_FLUSH_COMMANDS_BIT, 0) === gl.TIMEOUT_EXPIRED) this.lateReads++
      else {
        gl.deleteSync(fence)
        this.fences[previous] = null
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbos[previous])
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.floats)
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
      }
    }
    this.slot = next
  }

  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}

function link(gl: WebGL2RenderingContext, fragment: string): WebGLProgram {
  const build = (type: number, src: string) => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, src)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'compile failed')
    return shader
  }
  const program = gl.createProgram()
  gl.attachShader(program, build(gl.VERTEX_SHADER, `#version 300 es\nin vec2 p;\nvoid main() { gl_Position = vec4(p, 0.0, 1.0); }`))
  gl.attachShader(program, build(gl.FRAGMENT_SHADER, fragment))
  gl.bindAttribLocation(program, 0, 'p')
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link failed')
  return program
}

function glslFor(text: string): string {
  const { doc, problems } = readGraphFile(text)
  expect(problems).toEqual([])
  const shader = generateGlsl(doc)
  expect(shader.error).toBeNull()
  return shader.code
}

const write = (name: string, value: unknown) => commands.writeFile(`.work/perf/gpu/${name}.json`, JSON.stringify(value, null, 1))

describe.runIf(RUN)('gpu path probe', () => {
  const env = environment()

  it('records the environment', async () => {
    await write('environment', env)
  })

  it('readback strategies per graph and target', async () => {
    const names = ['bench-baseline', 'bench-gpu-heavy', 'bench-kitchen-sink', 'liquid-nebula', 'spectral-aurora']
    const results: unknown[] = []
    for (const name of names) {
      const code = glslFor(graphText[name])
      const { gl, canvas } = context()
      const probe = new ReadbackProbe(gl, code)
      const real = new ShaderRenderer(document.createElement('canvas'))
      real.compile(code)
      for (const target of TARGETS) {
        if (target.layout) real.setLayout(layoutPositions({ segments: [{ kind: 'matrix', width: target.layout, height: target.layout, serpentine: false, origin: 'top-left' }] }))
        // each mode gets its own loop: interleaving them lets one mode's queued draw be paid for by the next mode's wait
        const modes: Record<string, number[]> = {}
        const run = (key: string, fn: (frame: number) => void) => {
          const samples: number[] = []
          for (let frame = 0; frame < WARMUP + FRAMES; frame++) {
            const t0 = performance.now()
            fn(frame)
            const ms = performance.now() - t0
            if (frame >= WARMUP) samples.push(ms)
          }
          modes[key] = samples
        }
        probe.lateReads = 0
        probe.reads = 0
        run('none', (frame) => probe.drawOnly(target.leds, frame))
        run('sync', (frame) => probe.drawAndReadSync(target.leds, frame))
        const lateBefore = probe.lateReads
        const readsBefore = probe.reads
        run('pbo', (frame) => probe.drawAndReadAsync(target.leds, frame))
        probe.lateReads -= lateBefore
        probe.reads -= readsBefore
        run('renderLeds', (frame) => real.renderLeds({ time: frame / 60, dt: 1 / 60, frame, ledCount: target.leds, scanY: 0.5 }))
        results.push({
          graph: name,
          target: target.name,
          leds: target.leds,
          drawOnly: stats(modes.none),
          syncReadback: stats(modes.sync),
          pboAsync: stats(modes.pbo),
          rendererRenderLeds: stats(modes.renderLeds),
          stallMs: round(stats(modes.sync).median - stats(modes.none).median),
          pboOverheadMs: round(stats(modes.pbo).median - stats(modes.none).median),
          pboLateReads: `${probe.lateReads}/${probe.reads}`,
        })
      }
      // a tight loop hands the fence no wall time, so the PBO read is always still in flight; these runs space the
      // ticks the way the engine's setInterval does, which is the cadence the stall actually happens at
      for (const leds of [300, 4096]) {
        const paced: Record<string, number[]> = { sync: [], pbo: [] }
        probe.lateReads = 0
        probe.reads = 0
        for (let frame = 0; frame < 60; frame++) {
          await new Promise((resolve) => setTimeout(resolve, 16))
          const t0 = performance.now()
          probe.drawAndReadSync(leds, frame)
          if (frame >= 10) paced.sync.push(performance.now() - t0)
        }
        for (let frame = 0; frame < 60; frame++) {
          await new Promise((resolve) => setTimeout(resolve, 16))
          const t0 = performance.now()
          probe.drawAndReadAsync(leds, frame)
          if (frame >= 10) paced.pbo.push(performance.now() - t0)
        }
        results.push({ graph: name, target: `paced-16ms-${leds}`, leds, drawOnly: stats([]), syncReadback: stats(paced.sync), pboAsync: stats(paced.pbo), rendererRenderLeds: stats([]), stallMs: round(stats(paced.sync).median - stats(paced.pbo).median), pboOverheadMs: 0, pboLateReads: `${probe.lateReads}/${probe.reads}` })
      }
      probe.dispose()
      real.dispose()
      canvas.remove()
    }
    await write('readback', { env, frames: FRAMES, results })
  }, 900_000)

  it('pixel node families and preview resolution', async () => {
    const results: unknown[] = []
    for (const name of VARIANTS) {
      // written by .work/perf/gpu/gen-variants.mjs; without them only the showcase preview sweep runs
      const text = await commands.readFile(`.work/perf/gpu/graphs/${name}.wledgraph`).catch(() => null)
      if (typeof text !== 'string') continue
      const code = glslFor(text)
      const { gl, canvas } = context()
      const probe = new ReadbackProbe(gl, code)
      const ledSamples: number[] = []
      for (let frame = 0; frame < WARMUP + FRAMES; frame++) {
        const t0 = performance.now()
        probe.drawAndReadSync(4096, frame)
        if (frame >= WARMUP) ledSamples.push(performance.now() - t0)
      }
      probe.dispose()
      canvas.remove()

      const previews: Record<string, unknown> = {}
      for (const [w, h] of PREVIEW_SIZES) {
        const pv = document.createElement('canvas')
        pv.style.width = `${w}px`
        pv.style.height = `${h}px`
        document.body.appendChild(pv)
        const renderer = new ShaderRenderer(pv)
        renderer.compile(code)
        const pvGl = pv.getContext('webgl2')!
        const pixel = new Uint8Array(4)
        const samples: number[] = []
        for (let frame = 0; frame < WARMUP + 60; frame++) {
          const t0 = performance.now()
          renderer.renderPreview({ time: frame / 60, dt: 1 / 60, frame, ledCount: 60, scanY: 0.5 })
          pvGl.readPixels(0, 0, 1, 1, pvGl.RGBA, pvGl.UNSIGNED_BYTE, pixel)
          pvGl.finish()
          if (frame >= WARMUP) samples.push(performance.now() - t0)
        }
        previews[`${pv.width}x${pv.height}`] = stats(samples)
        renderer.dispose()
        pv.remove()
      }
      results.push({ variant: name, glslLines: code.split('\n').length, leds4096: stats(ledSamples), preview: previews })
    }

    const showcase: unknown[] = []
    for (const name of ['bar-sequencer', 'chroma-keys', 'high-contrast-music', 'kick-shockwave', 'liquid-nebula', 'peak-meteor', 'spectral-aurora']) {
      const code = glslFor(graphText[name])
      const previews: Record<string, unknown> = {}
      for (const [w, h] of PREVIEW_SIZES) {
        const pv = document.createElement('canvas')
        pv.style.width = `${w}px`
        pv.style.height = `${h}px`
        document.body.appendChild(pv)
        const renderer = new ShaderRenderer(pv)
        renderer.compile(code)
        const pvGl = pv.getContext('webgl2')!
        const pixel = new Uint8Array(4)
        const samples: number[] = []
        for (let frame = 0; frame < WARMUP + 60; frame++) {
          const t0 = performance.now()
          renderer.renderPreview({ time: frame / 60, dt: 1 / 60, frame, ledCount: 60, scanY: 0.5 })
          pvGl.readPixels(0, 0, 1, 1, pvGl.RGBA, pvGl.UNSIGNED_BYTE, pixel)
          pvGl.finish()
          if (frame >= WARMUP) samples.push(performance.now() - t0)
        }
        previews[`${pv.width}x${pv.height}`] = stats(samples)
        renderer.dispose()
        pv.remove()
      }
      showcase.push({ graph: name, usesFeedback: /\b(iPrevFrame|previousFrame)\b/.test(code), preview: previews })
    }
    await write('families', { env, frames: FRAMES, variants: results, showcase })
  }, 1_800_000)

  it('shader compile cost', async () => {
    const results: unknown[] = []
    const names = Object.keys(graphText).sort()
    for (const name of names) {
      const code = glslFor(graphText[name])
      const full = PRELUDE + code
      const measure = (src: string) => {
        const samples: number[] = []
        const firsts: number[] = []
        for (let i = 0; i < 5; i++) {
          const { gl, canvas } = context()
          gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
          gl.enableVertexAttribArray(0)
          gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
          const t0 = performance.now()
          const program = link(gl, src)
          samples.push(performance.now() - t0)
          const t1 = performance.now()
          gl.useProgram(program)
          gl.viewport(0, 0, 60, 1)
          gl.drawArrays(gl.TRIANGLES, 0, 3)
          gl.finish()
          firsts.push(performance.now() - t1)
          gl.getExtension('WEBGL_lose_context')?.loseContext()
          canvas.remove()
        }
        return { link: stats(samples), firstDraw: stats(firsts) }
      }
      results.push({
        graph: name,
        hasColorChunk: full.includes('color_srgb_to_scene_linear'),
        fullLines: full.split('\n').length,
        full: measure(full),
      })
    }
    await write('compile', { env, results })
  }, 900_000)

  it('feedback ping-pong and the uncached uniform lookup', async () => {
    const results: Record<string, unknown> = {}
    const presentSource = `#version 300 es
precision highp float;
uniform sampler2D source;
out vec4 color;
void main() { color = vec4(texelFetch(source, ivec2(gl_FragCoord.xy), 0).rgb, 1.0); }`
    const { gl, canvas } = context()
    const program = link(gl, presentSource)
    gl.useProgram(program)
    const CALLS = 200000
    results.getUniformLocationUs = round(batched(CALLS, () => { gl.getUniformLocation(program, 'source') }) * 1000)
    const cached = gl.getUniformLocation(program, 'source')
    results.uniform1iUs = round(batched(CALLS, () => { gl.uniform1i(cached, 7) }) * 1000)
    results.batchCalls = CALLS
    canvas.remove()

    for (const name of ['bench-feedback', 'bench-baseline', 'liquid-nebula', 'peak-meteor']) {
      const code = glslFor(graphText[name])
      const usesFeedback = /\b(iPrevFrame|previousFrame)\b/.test(code)
      const perTarget: Record<string, unknown> = {}
      for (const [w, h] of PREVIEW_SIZES.filter(([width]) => width === 480 || width === 1920)) {
        const pv = document.createElement('canvas')
        pv.style.width = `${w}px`
        pv.style.height = `${h}px`
        document.body.appendChild(pv)
        const renderer = new ShaderRenderer(pv)
        renderer.compile(code)
        const pvGl = pv.getContext('webgl2')!
        const pixel = new Uint8Array(4)
        const samples: number[] = []
        for (let frame = 0; frame < WARMUP + 60; frame++) {
          const t0 = performance.now()
          renderer.renderPreview({ time: frame / 60, dt: 1 / 60, frame, ledCount: 60, scanY: 0.5 })
          pvGl.readPixels(0, 0, 1, 1, pvGl.RGBA, pvGl.UNSIGNED_BYTE, pixel)
          pvGl.finish()
          if (frame >= WARMUP) samples.push(performance.now() - t0)
        }
        const leds: number[] = []
        for (let frame = 0; frame < WARMUP + 60; frame++) {
          const t0 = performance.now()
          renderer.renderLeds({ time: frame / 60, dt: 1 / 60, frame, ledCount: 4096, scanY: 0.5 })
          if (frame >= WARMUP) leds.push(performance.now() - t0)
        }
        perTarget[`${pv.width}x${pv.height}`] = { preview: stats(samples), leds4096: stats(leds) }
        renderer.dispose()
        pv.remove()
      }
      results[name] = { usesFeedback, perTarget }
    }
    await write('feedback', { env, results })
  }, 900_000)
})
