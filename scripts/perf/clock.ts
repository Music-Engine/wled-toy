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

async function main() {
  if (inApp) await mountApp()
  const rows: Record<string, unknown>[] = []
  const show = () => (out.textContent = JSON.stringify(rows, null, 1))
  for (const fps of [60, 90]) rows.push({ kind: 'interval', fps, idle: await measureIntervalRate(fps), busy4ms: await measureIntervalRate(fps, 4), busy12ms: await measureIntervalRate(fps, 12) }), show()
  for (const fps of [30, 60, 90, 120]) rows.push({ kind: 'deadline', fps, idle: await measureDeadlineRate(fps), busy4ms: await measureDeadlineRate(fps, 4), busy12ms: await measureDeadlineRate(fps, 12) }), show()
  const stream = params.get('stream') === '1'
  const engine = useEngine()
  if (stream && !engine.streaming.value) engine.toggleStream()
  for (const fps of [60, 90]) {
    rows.push({ kind: 'engine', fps, shader: 'plain', preview: 'off', ...(await measureEngineRate(fps, -1, PLAIN)) }), show()
    rows.push({ kind: 'engine', fps, shader: 'plain', preview: '60', ...(await measureEngineRate(fps, 60, PLAIN)) }), show()
    rows.push({ kind: 'engine', fps, shader: 'heavy', preview: 'off', ...(await measureEngineRate(fps, -1, HEAVY)) }), show()
    rows.push({ kind: 'engine', fps, shader: 'heavy', preview: '60', ...(await measureEngineRate(fps, 60, HEAVY)) }), show()
    rows.push({ kind: 'engine', fps, shader: 'heavy', preview: 'uncapped', ...(await measureEngineRate(fps, 0, HEAVY)) }), show()
  }
  if (stream && engine.streaming.value) engine.toggleStream()
  await fetch(receiver, { method: 'POST', mode: 'no-cors', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ label, stream, rows }) })
  out.textContent += '\nposted'
}

async function mountApp() {
  const root = document.createElement('div')
  root.id = 'app'
  root.style.cssText = 'height: 700px'
  document.body.prepend(root)
  await import('@/main')
  await pause(3000)
}

async function measureIntervalRate(fps: number, busyMs = 0) {
  let ticks = 0
  const stopBusy = startBusyLoop(busyMs)
  const start = performance.now()
  const timer = setInterval(() => ticks++, 1000 / fps)
  await pause(SECONDS * 1000)
  clearInterval(timer)
  stopBusy()
  return +(ticks / ((performance.now() - start) / 1000)).toFixed(1)
}

/** Tick due at start + n * period; one more than a period late is skipped, not caught up */
async function measureDeadlineRate(fps: number, busyMs = 0) {
  let ticks = 0
  const stopBusy = startBusyLoop(busyMs)
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
  stopBusy()
  return +(ticks / ((performance.now() - start) / 1000)).toFixed(1)
}

async function measureEngineRate(fps: number, previewFps: number, code: string) {
  const engine = useEngine()
  const host = document.getElementById('host')!
  if (!inApp) previewFps >= 0 ? host.append(engine.canvas) : engine.canvas.remove()
  preferences.previewFps = previewFps < 0 ? 60 : previewFps
  config.fps = fps
  if (!engine.compile(code)) throw new Error('compile failed')
  await pause(500)
  const gaps = recordTickGaps(engine.bridge)
  const start = performance.now()
  await pause(SECONDS * 1000)
  gaps.stop()
  const rate = gaps.list.length / ((performance.now() - start) / 1000)
  gaps.list.sort((a, b) => a - b)
  const readPercentile = (q: number) => +(gaps.list[Math.min(gaps.list.length - 1, Math.floor(q * gaps.list.length))] ?? 0).toFixed(1)
  const { stats } = engine.bridge
  return { rate: +rate.toFixed(1), ledRenderMs: +(stats.ledRenderMs ?? 0).toFixed(2), sendFps: +stats.sendFps.toFixed(1), dropped: stats.framesDropped, gapP50: readPercentile(0.5), gapP90: readPercentile(0.9), gapMax: readPercentile(1) }
}

/** Bridge hears every rendered LED frame, so it times the ticks */
function recordTickGaps(bridge: ReturnType<typeof useEngine>['bridge']) {
  const list: number[] = []
  let last = performance.now()
  const record = bridge.recordLedRender
  bridge.recordLedRender = (ms) => {
    const now = performance.now()
    list.push(now - last)
    last = now
    return record(ms)
  }
  return { list, stop: () => (bridge.recordLedRender = record) }
}

/** Holds the main thread `busyMs` every animation frame; returns the stop */
function startBusyLoop(busyMs: number): () => void {
  let frame = 0
  const burn = () => {
    frame = requestAnimationFrame(burn)
    const until = performance.now() + busyMs
    while (performance.now() < until) { /* hold the main thread */ }
  }
  if (busyMs) frame = requestAnimationFrame(burn)
  return () => cancelAnimationFrame(frame)
}

const fail = (e: unknown) => {
  out.textContent = String(e)
  void fetch(receiver, { method: 'POST', mode: 'no-cors', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ label, error: String((e as Error)?.stack ?? e), rows: [] }) })
}
window.addEventListener('error', (e) => fail(e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => fail(e.reason))
main().catch(fail)
