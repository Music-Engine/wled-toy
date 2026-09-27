import { createApp } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { commands } from 'vitest/browser'
import { config } from '@/lib/app/settings/config'
import { preferences } from '@/lib/app/settings/preferences'
import LedStrip from '@/features/output/preview/LedStrip.vue'
import { useEngine } from './engine'

/*
 * Measures how many LED ticks the engine actually delivers against the configured fps, with and without the
 * preview loop competing for the main thread. Run with PERF_CLOCK=1; BENCH_GPU=1 uses the real GPU.
 */
const enabled = import.meta.env.VITE_PERF_CLOCK === '1'

const PLAIN = 'void mainImage(out vec4 c, vec2 uv, float ledIndex) { c = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0); }'
// a few hundred iterations per pixel: enough GPU time per preview frame to show up in a synchronous readback
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

/** Achieved rate of a bare setInterval at `fps`, optionally with a rAF loop that burns `busyMs` per frame. */
async function intervalRate(fps: number, busyMs = 0) {
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

/** LED ticks per second the engine delivers at `fps`, preview running at `previewFps` (0 uncapped, -1 detached). */
async function engineRate(fps: number, previewFps: number, code: string, seconds = SECONDS) {
  const engine = useEngine()
  if (previewFps >= 0) document.body.append(engine.canvas)
  else engine.canvas.remove()
  preferences.previewFps = previewFps < 0 ? 60 : previewFps
  config.fps = fps
  expect(engine.compile(code, 'shader')).toBe(true)
  let ticks = 0
  const durations: number[] = []
  let last = performance.now()
  // the bridge hears about every rendered LED frame, which makes it the place to time the ticks
  const record = engine.bridge.recordLedRender
  engine.bridge.recordLedRender = (ms) => {
    const now = performance.now()
    durations.push(now - last)
    last = now
    ticks++
    return record(ms)
  }
  const stop = () => (engine.bridge.recordLedRender = record)
  await pause(500)
  ticks = 0
  durations.length = 0
  last = performance.now()
  const start = performance.now()
  await pause(seconds * 1000)
  stop()
  const rate = ticks / ((performance.now() - start) / 1000)
  durations.sort((a, b) => a - b)
  const p = (q: number) => durations[Math.min(durations.length - 1, Math.floor(q * durations.length))]?.toFixed(1)
  return { rate: +rate.toFixed(1), ledRenderMs: +(engine.bridge.stats.ledRenderMs ?? 0).toFixed(2), gapP50: p(0.5), gapP90: p(0.9), gapMax: p(1) }
}

// Chromium truncates a timer interval to whole milliseconds and WebKit fires a repeating timer late, so a plain
// setInterval at 1000 / fps never delivers fps: 62.5 for 60 in Chromium, 50 in Safari. The clock has to hold the rate.
it('the LED clock holds the configured fps within two percent', async () => {
  const rows: Array<{ fps: number; rate: number }> = []
  for (const fps of [30, 60, 90, 120]) rows.push({ fps, ...(await engineRate(fps, -1, PLAIN, 2)) })
  expect(rows.map((row) => `${row.fps}: ${row.rate}`).filter((_, i) => Math.abs(rows[i].rate - rows[i].fps) > rows[i].fps * 0.02)).toEqual([])
}, 60_000)

// a view drawing inside the tick used to hold the next tick's readback on its GPU work: 18 ms per tick and 53 ticks at fps 60
it('the LED strip draws off the tick', async () => {
  const ledCount = config.ledCount
  config.ledCount = 300
  const bare = await engineRate(60, -1, PLAIN, 3)

  // browser tests run without Tailwind; this is the box the strip's classes give it in the app
  const style = document.createElement('style')
  style.textContent = '.led-monitor { position: relative; height: 64px; overflow: hidden } .led-monitor canvas { position: absolute; inset: 0; width: 100%; height: 100% }'
  const host = document.createElement('div')
  host.style.width = '1200px'
  document.head.append(style)
  document.body.append(host)
  const app = createApp(LedStrip)
  app.mount(host)
  const draws = vi.spyOn(CanvasRenderingContext2D.prototype, 'putImageData')
  let frames = 0
  let raf = requestAnimationFrame(function count() {
    frames++
    raf = requestAnimationFrame(count)
  })
  const withStrip = await engineRate(60, -1, PLAIN, 3)
  cancelAnimationFrame(raf)
  const drawn = draws.mock.calls.length
  draws.mockRestore()
  app.unmount()
  host.remove()
  style.remove()
  config.ledCount = ledCount

  expect(Math.abs(withStrip.rate - bare.rate)).toBeLessThanOrEqual(bare.rate * 0.05)
  expect(withStrip.ledRenderMs).toBeLessThan(4)
  expect(drawn).toBeGreaterThan(0)
  expect(drawn).toBeLessThanOrEqual(frames + 1)
}, 30_000)

describe.skipIf(!enabled)('LED clock probe', () => {
  it('bare setInterval reaches the configured rate', async () => {
    const rows = []
    for (const fps of [30, 60, 90, 120]) {
      rows.push({ fps, idle: +(await intervalRate(fps)).toFixed(1), busy4ms: +(await intervalRate(fps, 4)).toFixed(1), busy12ms: +(await intervalRate(fps, 12)).toFixed(1) })
    }
    await commands.writeFile(`.work/perf/clock/interval-${label}.json`, JSON.stringify(rows, null, 1))
    expect(rows.every((row) => row.idle > row.fps * 0.95)).toBe(true)
  }, 120_000)

  it('engine ticks against the configured fps with the preview on and off', async () => {
    const rows = []
    for (const fps of [60, 90]) {
      rows.push({ fps, shader: 'plain', preview: 'off', ...(await engineRate(fps, -1, PLAIN)) })
      rows.push({ fps, shader: 'plain', preview: '60', ...(await engineRate(fps, 60, PLAIN)) })
      rows.push({ fps, shader: 'heavy', preview: 'off', ...(await engineRate(fps, -1, HEAVY)) })
      rows.push({ fps, shader: 'heavy', preview: '60', ...(await engineRate(fps, 60, HEAVY)) })
      rows.push({ fps, shader: 'heavy', preview: 'uncapped', ...(await engineRate(fps, 0, HEAVY)) })
    }
    await commands.writeFile(`.work/perf/clock/engine-${label}.json`, JSON.stringify(rows, null, 1))
    useEngine().dispose()
    expect(rows.length).toBe(10)
  }, 180_000)
})
