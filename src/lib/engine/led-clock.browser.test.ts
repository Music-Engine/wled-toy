import { createApp } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { commands } from 'vitest/browser'
import { config } from '@/lib/app/settings/config'
import { preferences } from '@/lib/app/settings/preferences'
import LedStrip from '@/features/output/preview/LedStrip.vue'
import { useEngine } from './engine'

// LED ticks delivered vs configured fps, w/ and w/o the preview competing; PERF_CLOCK=1 runs it, BENCH_GPU=1 on the real GPU
const enabled = import.meta.env.VITE_PERF_CLOCK === '1'

const PLAIN = 'void mainImage(out vec4 c, vec2 uv, float ledIndex) { c = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0); }'
// Enough GPU time per preview frame to show in a sync readback
const HEAVY = `void mainImage(out vec4 c, vec2 uv, float ledIndex) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 400; i++) { acc += 0.001 * sin(uv.xyx * float(i) + iTime); }
  c = vec4(acc, 1.0);
}`

const SECONDS = 4
const label = import.meta.env.VITE_PERF_LABEL ?? 'run'

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Bare setInterval rate at `fps`, optionally beside a rAF loop burning `busyMs` per frame */
async function measureIntervalRate(fps: number, busyMs = 0) {
  let ticks = 0
  let raf = 0
  const burn = () => {
    raf = requestAnimationFrame(burn)
    const until = performance.now() + busyMs
    while (performance.now() < until) { /* hold the main thread */ }
  }
  if (busyMs) raf = requestAnimationFrame(burn)
  const start = performance.now()
  const timer = setInterval(() => ticks++, 1000 / fps)
  await pause(SECONDS * 1000)
  clearInterval(timer)
  cancelAnimationFrame(raf)
  return ticks / ((performance.now() - start) / 1000)
}

/** Engine LED ticks per second at `fps`, preview at `previewFps` (0 uncapped, -1 detached) */
async function measureEngineRate(fps: number, previewFps: number, code: string, seconds = SECONDS) {
  const engine = useEngine()
  if (previewFps >= 0) document.body.append(engine.canvas)
  else engine.canvas.remove()
  preferences.previewFps = previewFps < 0 ? 60 : previewFps
  config.fps = fps
  expect(engine.compile(code)).toBe(true)
  const ticks = watchLedTicks(engine)
  await pause(500)
  ticks.restart()
  await pause(seconds * 1000)
  ticks.stop()
  const rate = ticks.durations.length / ((performance.now() - ticks.start) / 1000)
  const gaps = ticks.durations.sort((a, b) => a - b)
  const readQuantile = (q: number) => gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))]?.toFixed(1)
  return { rate: +rate.toFixed(1), ledRenderMs: +(engine.bridge.stats.ledRenderMs ?? 0).toFixed(2), gapP50: readQuantile(0.5), gapP90: readQuantile(0.9), gapMax: readQuantile(1) }
}

// Bridge hears of every rendered LED frame, so ticks are timed there
function watchLedTicks(engine: ReturnType<typeof useEngine>) {
  const record = engine.bridge.recordLedRender
  const watched = {
    durations: [] as number[],
    start: performance.now(),
    last: performance.now(),
    restart() {
      watched.durations.length = 0
      watched.start = watched.last = performance.now()
    },
    stop: () => (engine.bridge.recordLedRender = record),
  }
  engine.bridge.recordLedRender = (ms) => {
    const now = performance.now()
    watched.durations.push(now - watched.last)
    watched.last = now
    return record(ms)
  }
  return watched
}

/** 1200 px wide */
function mountStrip() {
  // No Tailwind in browser tests: the box the strip's classes give it in the app
  const style = document.createElement('style')
  style.textContent = '.led-monitor { position: relative; height: 64px; overflow: hidden } .led-monitor canvas { position: absolute; inset: 0; width: 100%; height: 100% }'
  const host = document.createElement('div')
  host.style.width = '1200px'
  document.head.append(style)
  document.body.append(host)
  const app = createApp(LedStrip)
  app.mount(host)
  return { host, unmount: () => { app.unmount(); host.remove(); style.remove() } }
}

// Chromium truncates intervals to whole ms and WebKit fires late, so setInterval never delivers fps (62.5 for 60 in
// Chromium, 50 in Safari); the clock must hold it. 120 fps is left to the gated probe: loaded CI runners miss 8 ms
it('the LED clock holds the configured fps within two percent', async () => {
  const rows: Array<{ fps: number; rate: number }> = []
  for (const fps of [30, 60, 90]) rows.push({ fps, ...(await measureEngineRate(fps, -1, PLAIN, 2)) })
  expect(rows.map((row) => `${row.fps}: ${row.rate}`).filter((_, i) => Math.abs(rows[i].rate - rows[i].fps) > rows[i].fps * 0.02)).toEqual([])
}, 60_000)

// Software renderer draws the strip on the CPU, stalling the readback (13 ms on CI): only a GPU shows the draw is off the tick
const softwareRenderer = (() => {
  const gl = document.createElement('canvas').getContext('webgl2')
  const info = gl?.getExtension('WEBGL_debug_renderer_info')
  return !!gl && !!info && /SwiftShader|llvmpipe/i.test(String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)))
})()

// A view drawing inside the tick used to stall the next readback: 18 ms per tick, 53 ticks at fps 60
it.skipIf(softwareRenderer)('the LED strip draws off the tick', async () => {
  const ledCount = config.ledCount
  config.ledCount = 300
  const bare = await measureEngineRate(60, -1, PLAIN, 3)

  const strip = mountStrip()
  const draws = vi.spyOn(CanvasRenderingContext2D.prototype, 'putImageData')
  let frames = 0
  let raf = requestAnimationFrame(function count() {
    frames++
    raf = requestAnimationFrame(count)
  })
  const withStrip = await measureEngineRate(60, -1, PLAIN, 3)
  cancelAnimationFrame(raf)
  const drawn = draws.mock.calls.length
  draws.mockRestore()
  strip.unmount()
  config.ledCount = ledCount

  expect(Math.abs(withStrip.rate - bare.rate)).toBeLessThanOrEqual(bare.rate * 0.05)
  // Regression was 18 ms vs 2; bound relative to the bare run also holds on SwiftShader (bare tick 13 ms)
  expect(withStrip.ledRenderMs).toBeLessThanOrEqual(bare.ledRenderMs * 1.5 + 1)
  expect(drawn).toBeGreaterThan(0)
  expect(drawn).toBeLessThanOrEqual(frames + 1)
}, 30_000)

// Moving to another display density or zooming fires no resize
it('the LED strip follows a display density change', async () => {
  const strip = mountStrip()
  const canvas = strip.host.querySelector('canvas')!
  await expect.poll(() => canvas.width).toBe(Math.round(1200 * devicePixelRatio))
  Object.defineProperty(window, 'devicePixelRatio', { value: devicePixelRatio * 2, configurable: true })
  try {
    await expect.poll(() => canvas.width).toBe(Math.round(1200 * devicePixelRatio))
  } finally {
    delete (window as { devicePixelRatio?: number }).devicePixelRatio
    strip.unmount()
  }
})

describe.skipIf(!enabled)('LED clock probe', () => {
  it('bare setInterval reaches the configured rate', async () => {
    const rows = []
    for (const fps of [30, 60, 90, 120]) {
      rows.push({ fps, idle: +(await measureIntervalRate(fps)).toFixed(1), busy4ms: +(await measureIntervalRate(fps, 4)).toFixed(1), busy12ms: +(await measureIntervalRate(fps, 12)).toFixed(1) })
    }
    await commands.writeFile(`.work/perf/clock/interval-${label}.json`, JSON.stringify(rows, null, 1))
    expect(rows.every((row) => row.idle > row.fps * 0.95)).toBe(true)
  }, 120_000)

  it('engine ticks against the configured fps with the preview on and off', async () => {
    const rows = []
    for (const fps of [60, 90, 120]) {
      rows.push({ fps, shader: 'plain', preview: 'off', ...(await measureEngineRate(fps, -1, PLAIN)) })
      rows.push({ fps, shader: 'plain', preview: '60', ...(await measureEngineRate(fps, 60, PLAIN)) })
      rows.push({ fps, shader: 'heavy', preview: 'off', ...(await measureEngineRate(fps, -1, HEAVY)) })
      rows.push({ fps, shader: 'heavy', preview: '60', ...(await measureEngineRate(fps, 60, HEAVY)) })
      rows.push({ fps, shader: 'heavy', preview: 'uncapped', ...(await measureEngineRate(fps, 0, HEAVY)) })
    }
    await commands.writeFile(`.work/perf/clock/engine-${label}.json`, JSON.stringify(rows, null, 1))
    useEngine().dispose()
    expect(rows.length).toBe(10)
  }, 180_000)
})
