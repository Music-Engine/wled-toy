import { config } from '@/lib/app/settings/config'
import { preferences } from '@/lib/app/settings/preferences'
import { useEngine } from '@/lib/engine/engine'

const PLAIN = 'void mainImage(out vec4 c, vec2 uv, float ledIndex) { c = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0); }'
const HEAVY = `void mainImage(out vec4 c, vec2 uv, float ledIndex) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 400; i++) { acc += 0.001 * sin(uv.xyx * float(i) + iTime); }
  c = vec4(acc, 1.0);
}`
const SECONDS = 4
const params = new URLSearchParams(location.search)
const receiver = params.get('post') ?? 'http://localhost:5199/'
const label = params.get('label') ?? navigator.userAgent.replace(/.*\) /, '').slice(0, 60)
const out = document.getElementById('out')!
const inApp = params.get('app') === '1'
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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
  return +(ticks / ((performance.now() - start) / 1000)).toFixed(1)
}

/** A drift-free clock: each tick is due at start + n * period, and a tick more than one period late is skipped, not caught up. */
async function deadlineRate(fps: number, busyMs = 0) {
  let ticks = 0
  let raf = 0
  const burn = () => {
    raf = requestAnimationFrame(burn)
    const until = performance.now() + busyMs
    while (performance.now() < until) { /* hold the main thread */ }
  }
  if (busyMs) raf = requestAnimationFrame(burn)
  const period = 1000 / fps
  const start = performance.now()
  let due = start + period
  let timer = 0
  const tick = () => {
    ticks++
    const now = performance.now()
    due += period
    if (due < now) due = now + period
    timer = window.setTimeout(tick, due - now)
  }
  timer = window.setTimeout(tick, period)
  await pause(SECONDS * 1000)
  clearTimeout(timer)
  cancelAnimationFrame(raf)
  return +(ticks / ((performance.now() - start) / 1000)).toFixed(1)
}

async function engineRate(fps: number, previewFps: number, code: string) {
  const engine = useEngine()
  const host = document.getElementById('host')!
  if (!inApp) previewFps >= 0 ? host.append(engine.canvas) : engine.canvas.remove()
  preferences.previewFps = previewFps < 0 ? 60 : previewFps
  config.fps = fps
  if (!engine.compile(code)) throw new Error('compile failed')
  let ticks = 0
  const gaps: number[] = []
  let last = performance.now()
  // the bridge hears about every rendered LED frame, which makes it the place to time the ticks
  const record = engine.bridge.recordLedRender
  engine.bridge.recordLedRender = (ms) => {
    const now = performance.now()
    gaps.push(now - last)
    last = now
    ticks++
    return record(ms)
  }
  const stop = () => (engine.bridge.recordLedRender = record)
  await pause(500)
  ticks = 0
  gaps.length = 0
  last = performance.now()
  const start = performance.now()
  await pause(SECONDS * 1000)
  stop()
  const rate = ticks / ((performance.now() - start) / 1000)
  gaps.sort((a, b) => a - b)
  const p = (q: number) => +(gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))] ?? 0).toFixed(1)
  return { rate: +rate.toFixed(1), ledRenderMs: +(engine.bridge.stats.ledRenderMs ?? 0).toFixed(2), sendFps: +engine.bridge.stats.sendFps.toFixed(1), dropped: engine.bridge.stats.framesDropped, gapP50: p(0.5), gapP90: p(0.9), gapMax: p(1) }
}

async function main() {
  if (inApp) {
    const root = document.createElement('div')
    root.id = 'app'
    root.style.cssText = 'height: 700px'
    document.body.prepend(root)
    await import('@/main')
    await pause(3000)
  }
  const rows: Record<string, unknown>[] = []
  const show = () => (out.textContent = JSON.stringify(rows, null, 1))
  for (const fps of [60, 90]) rows.push({ kind: 'interval', fps, idle: await intervalRate(fps), busy4ms: await intervalRate(fps, 4), busy12ms: await intervalRate(fps, 12) }), show()
  for (const fps of [30, 60, 90, 120]) rows.push({ kind: 'deadline', fps, idle: await deadlineRate(fps), busy4ms: await deadlineRate(fps, 4), busy12ms: await deadlineRate(fps, 12) }), show()
  const stream = params.get('stream') === '1'
  const engine = useEngine()
  if (stream && !engine.streaming.value) engine.toggleStream()
  for (const fps of [60, 90]) {
    rows.push({ kind: 'engine', fps, shader: 'plain', preview: 'off', ...(await engineRate(fps, -1, PLAIN)) }), show()
    rows.push({ kind: 'engine', fps, shader: 'plain', preview: '60', ...(await engineRate(fps, 60, PLAIN)) }), show()
    rows.push({ kind: 'engine', fps, shader: 'heavy', preview: 'off', ...(await engineRate(fps, -1, HEAVY)) }), show()
    rows.push({ kind: 'engine', fps, shader: 'heavy', preview: '60', ...(await engineRate(fps, 60, HEAVY)) }), show()
    rows.push({ kind: 'engine', fps, shader: 'heavy', preview: 'uncapped', ...(await engineRate(fps, 0, HEAVY)) }), show()
  }
  if (stream && engine.streaming.value) engine.toggleStream()
  await fetch(receiver, { method: 'POST', mode: 'no-cors', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ label, stream, rows }) })
  out.textContent += '\nposted'
}
const fail = (e: unknown) => {
  out.textContent = String(e)
  void fetch(receiver, { method: 'POST', mode: 'no-cors', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ label, error: String((e as Error)?.stack ?? e), rows: [] }) })
}
window.addEventListener('error', (e) => fail(e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => fail(e.reason))
main().catch(fail)
