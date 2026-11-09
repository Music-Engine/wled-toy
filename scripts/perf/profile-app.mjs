import { chromium } from 'playwright'
const url = process.argv[2] ?? 'http://localhost:5180/'
const seconds = Number(process.argv.filter((a) => !a.startsWith('--'))[3] ?? 6)
const headed = process.argv.includes('--headed')
const browser = await chromium.launch({
  headless: !headed,
  args: [
    '--use-angle=metal',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200))
})
const flags = process.argv.filter((a) => a.startsWith('--') && a !== '--headed').map((a) => a.slice(2))
await page.addInitScript((f) => {
  window.__flags = f
  if (f.includes('noblur'))
    Object.defineProperty(CanvasRenderingContext2D.prototype, 'shadowBlur', {
      set() {},
      get() {
        return 0
      },
    })
  if (f.includes('cpu2d')) {
    const get = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, options) {
      return get.call(this, type, type === '2d' ? { ...options, willReadFrequently: true } : options)
    }
  }
}, flags)
await page.goto(url)
await page.waitForTimeout(5000)
const setup = await page.evaluate(async () => {
  const { useEngine } = await import('/src/lib/engine/engine.ts')
  const { config } = await import('/src/lib/app/settings/config.ts')
  const engine = useEngine()
  const { workspace } = await import('/src/lib/app/workspace.ts')
  const { preferences } = await import('/src/lib/app/settings/preferences.ts')
  const flags = new Set(window.__flags ?? '')
  if (flags.has('nostrip')) workspace.stripVisible = false
  if (flags.has('plain')) engine.compile('void mainImage(out vec4 c, vec2 uv, float ledIndex) { c = vec4(uv, 0.5 + 0.5 * sin(iTime), 1.0); }', 'shader')
  if (flags.has('nopreview')) preferences.previewFps = 1
  if (flags.has('bigpreview')) preferences.previewHeight = 0
  config.fps = 60
  if (!engine.streaming.value) engine.toggleStream()
  return {
    ledCount: config.ledCount,
    layout: !!config.layout,
    route: location.pathname,
    canvas: [engine.canvas.width, engine.canvas.height],
    audio: { ...engine.audio.state, settings: { ...engine.audio.state.settings } },
  }
})
console.log('setup', JSON.stringify({ flags, ...setup }))
await page.waitForTimeout(1500)
const cdp = await page.context().newCDPSession(page)
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
await cdp.send('Profiler.start')
const rates = await page.evaluate(async (seconds) => {
  const pause = (ms) => new Promise((r) => setTimeout(r, ms))
  let ticks = 0
  let frames = 0
  let raf = 0
  const loop = () => {
    frames++
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)
  const long = []
  const po = new PerformanceObserver((list) => list.getEntries().forEach((e) => long.push(Math.round(e.duration))))
  po.observe({ type: 'longtask' })
  const timer = setInterval(() => ticks++, 1000 / 60)
  const { useEngine } = await import('/src/lib/engine/engine.ts')
  const engine = useEngine()
  const firstRevision = engine.ledRevision()
  const start = performance.now()
  await pause(seconds * 1000)
  const dt = (performance.now() - start) / 1000
  clearInterval(timer)
  cancelAnimationFrame(raf)
  po.disconnect()
  const led = engine.ledRevision() - firstRevision
  return {
    interval60: +(ticks / dt).toFixed(1),
    raf: +(frames / dt).toFixed(1),
    ledTicks: +(led / dt).toFixed(1),
    longTasks: long.length,
    longTaskMs: long.reduce((a, b) => a + b, 0),
    longest: Math.max(0, ...long),
    stats: { ...engine.bridge.stats, device: undefined },
  }
}, seconds)
const { profile } = await cdp.send('Profiler.stop')
console.log('rates', JSON.stringify(rates))
const byId = new Map(profile.nodes.map((n) => [n.id, n]))
const self = new Map()
const total = profile.timeDeltas.reduce((a, b) => a + b, 0) / 1000
profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000))
const short = (u) =>
  u
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/\?.*$/, '')
    .replace(/^\/node_modules\/\.pnpm\/([^/]+)\/.*/, 'npm:$1')
    .replace(/^\/@fs.*\/node_modules\/\.pnpm\/([^/]+)\/.*/, 'npm:$1')
const byFn = new Map(),
  byUrl = new Map()
for (const [id, ms] of self) {
  const f = byId.get(id).callFrame
  const key = `${f.functionName || '(anonymous)'} ${short(f.url)}:${f.lineNumber + 1}`
  byFn.set(key, (byFn.get(key) ?? 0) + ms)
  const u = short(f.url) || `(${f.functionName || 'native'})`
  byUrl.set(u, (byUrl.get(u) ?? 0) + ms)
}
const top = (m, n) =>
  [...m]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${v.toFixed(0).padStart(6)} ms ${((100 * v) / total).toFixed(1).padStart(5)}%  ${k}`)
    .join('\n')
console.log(`total ${total.toFixed(0)} ms sampled over ${seconds}s\n--- by file\n${top(byUrl, 18)}\n--- by function\n${top(byFn, 40)}`)
await browser.close()
