import { mkdirSync, writeFileSync } from 'node:fs'
import { PerformanceObserver } from 'node:perf_hooks'
import { Session } from 'node:inspector'
import { describe, expect, it } from 'vitest'
import { Analyzer, DEFAULT_ANALYZER, Fft, Filterbank, OnsetDetector, SampleRing, TempoTracker, centroid, chroma, createWindow, flatness, peak, rms, Agc, SilenceGate, type AnalyzerConfig } from './index'
import { AudioTextures } from '@/lib/audio/textures'
import { SAMPLE_RATE, synthTrack } from '@/lib/graph/testing/offline'

// Node-side benchmark of the DSP analyzer, per stage. Chromium clamps performance.now() to 0.1 ms, which is more
// than six of the nine stages cost, so the browser harness cannot split the hop; node can. Skipped unless
// PERF_CPU=1, so pnpm test stays fast. See graphs/bench/README.md.
const RUN = process.env.PERF_CPU === '1'
const OUT = '.work/perf/cpu'

interface Stat { ns: number; lo: number; hi: number; reps: number }

function bench(fn: () => void, iterations: number, reps = 7): Stat {
  for (let i = 0; i < Math.min(iterations, 200); i++) fn()
  const per: number[] = []
  for (let r = 0; r < reps; r++) {
    const t0 = process.hrtime.bigint()
    for (let i = 0; i < iterations; i++) fn()
    per.push(Number(process.hrtime.bigint() - t0) / iterations)
  }
  per.sort((a, b) => a - b)
  return { ns: per[Math.floor(per.length / 2)], lo: per[0], hi: per[per.length - 1], reps }
}

function rawAlloc(fn: () => void, batch: number, reps: number): number {
  const gc = globalThis.gc
  if (!gc) throw new Error('run with --expose-gc')
  for (let i = 0; i < batch; i++) fn()
  const deltas: number[] = []
  for (let r = 0; r < reps; r++) {
    gc()
    const before = process.memoryUsage().heapUsed
    for (let i = 0; i < batch; i++) fn()
    deltas.push((process.memoryUsage().heapUsed - before) / batch)
  }
  deltas.sort((a, b) => a - b)
  return deltas[Math.floor(deltas.length / 2)]
}

/**
 * Bytes the heap grows per call of `fn`, above an empty function measured the same way. Run the process with
 * --max-semi-space-size=64 so a batch does not trigger a scavenge, or the growth is the survivors, not the
 * allocation. Typed array backing stores are external and do not show here. A sampling heap profile cannot answer
 * this either: V8 drops samples whose objects were collected, which is most short-lived garbage.
 */
function allocPerCall(fn: () => void, batch = 500, reps = 9): number {
  return rawAlloc(fn, batch, reps) - rawAlloc(() => {}, batch, reps)
}

const SLOTS: { name: string; config: Omit<AnalyzerConfig, 'sampleRate'> }[] = [
  { name: 'default 2048/512/64 hann mel', config: { ...DEFAULT_ANALYZER } },
  { name: 'fft0 8192/128/256 hann mel', config: { ...DEFAULT_ANALYZER, windowSize: 8192, hop: 128, bands: 256, window: 'hann', scale: 'mel' } },
  { name: 'fft1 8192/128/256 hamming mel', config: { ...DEFAULT_ANALYZER, windowSize: 8192, hop: 128, bands: 256, window: 'hamming', scale: 'mel' } },
  { name: 'fft2 8192/128/256 blackman log', config: { ...DEFAULT_ANALYZER, windowSize: 8192, hop: 128, bands: 256, window: 'blackman', scale: 'log' } },
]

describe.runIf(RUN)('cpu profile: audio', () => {
  const track = synthTrack(10)
  mkdirSync(OUT, { recursive: true })

  it('analyzer per hop, by stage', () => {
    const rows: Record<string, unknown>[] = []
    for (const { name, config } of SLOTS) {
      const full = { ...config, sampleRate: SAMPLE_RATE }
      const analyzer = new Analyzer(full)
      const textures = new AudioTextures(config.bands, SAMPLE_RATE)
      let at = 0
      const nextHop = () => {
        at = (at + config.hop) % (track.length - config.hop)
        return track.subarray(at, at + config.hop)
      }
      const total = bench(() => { analyzer.process(nextHop()) }, 2000)
      const texture = bench(() => { const h = nextHop(); textures.push(h, analyzer.process(h)) }, 1000)

      const fft = new Fft(config.windowSize)
      const window = createWindow(config.window, config.windowSize)
      const windowGain = 2 / window.reduce((a, b) => a + b, 0)
      const ring = new SampleRing(config.windowSize)
      const frame = new Float32Array(config.windowSize)
      const windowed = new Float32Array(config.windowSize)
      const spectrum = new Float32Array(config.windowSize / 2)
      const bands = new Float32Array(config.bands)
      const outBands = new Float32Array(config.bands)
      const filterbank = new Filterbank(config, SAMPLE_RATE, config.windowSize)
      const chromaOut = new Float32Array(12)
      const onsets = new OnsetDetector(SAMPLE_RATE / config.hop)
      const tempo = new TempoTracker(SAMPLE_RATE / config.hop)
      const agc = new Agc(config.agc)
      const gate = new SilenceGate(config.gate.thresholdDb, config.gate.hold)
      const dt = config.hop / SAMPLE_RATE
      for (let i = 0; i < 200; i++) { ring.push(nextHop()) }
      ring.read(frame)
      for (let i = 0; i < frame.length; i++) windowed[i] = frame[i] * window[i]
      fft.magnitudes(windowed, windowGain, spectrum)
      filterbank.apply(spectrum, bands)

      const stages: Record<string, Stat> = {
        ringAndWindow: bench(() => {
          ring.push(nextHop())
          ring.read(frame)
          for (let i = 0; i < frame.length; i++) windowed[i] = frame[i] * window[i]
        }, 2000),
        fft: bench(() => { fft.magnitudes(windowed, windowGain, spectrum) }, 2000),
        filterbank: bench(() => { filterbank.apply(spectrum, bands) }, 2000),
        levelAgc: bench(() => {
          const h = nextHop()
          const r = rms(h)
          peak(h)
          const open = gate.open(r, dt)
          const g = agc.gain(Math.max(...bands), dt)
          for (let i = 0; i < outBands.length; i++) outBands[i] = open ? Math.sqrt(Math.min(1, bands[i] * g)) : 0
        }, 2000),
        onset: bench(() => { onsets.process(bands) }, 2000),
        tempoProcess: bench(() => { tempo.process(0.3 + Math.random() * 0.1) }, 2000),
        chroma: bench(() => { chroma(spectrum, SAMPLE_RATE, config.windowSize, config.fmin, Math.min(config.fmax, 5000), chromaOut) }, 2000),
        centroid: bench(() => { centroid(spectrum, SAMPLE_RATE, config.windowSize) }, 2000),
        flatness: bench(() => { flatness(spectrum) }, 2000),
      }
      rows.push({ slot: name, hopRate: SAMPLE_RATE / config.hop, total, totalPlusTextures: texture, stages })
    }
    writeFileSync(`${OUT}/analyzer-stages.json`, JSON.stringify(rows, null, 2))
    expect(rows.length).toBe(4)
  }, 900_000)

  it('fft scaling by size, and the magnitude loop inside it', () => {
    const rows = [512, 1024, 2048, 4096, 8192].map((size) => {
      const fft = new Fft(size)
      const window = createWindow('hann', size)
      const windowed = Float32Array.from({ length: size }, (_, i) => track[i] * window[i])
      const out = new Float32Array(size / 2)
      const gain = 2 / window.reduce((a, b) => a + b, 0)
      fft.magnitudes(windowed, gain, out)
      const re = new Float32Array(size)
      const im = new Float32Array(size)
      re.set(windowed)
      return {
        size,
        magnitudesNs: bench(() => { fft.magnitudes(windowed, gain, out) }, 3000).ns,
        hypotLoopNs: bench(() => { for (let i = 0; i < size / 2; i++) out[i] = Math.hypot(re[i], im[i]) * gain }, 3000).ns,
        sqrtLoopNs: bench(() => { for (let i = 0; i < size / 2; i++) out[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * gain }, 3000).ns,
      }
    })
    writeFileSync(`${OUT}/fft-scaling.json`, JSON.stringify(rows, null, 2))
    expect(rows.length).toBe(5)
  }, 900_000)

  it('tempo estimate cost by hop rate', () => {
    const rows: Record<string, unknown>[] = []
    for (const hop of [2048, 1024, 512, 256, 128]) {
      const hopRate = SAMPLE_RATE / hop
      const tempo = new TempoTracker(hopRate)
      const times: number[] = []
      for (let i = 0; i < Math.ceil(hopRate * 20); i++) {
        const v = 0.2 + (i % 17 === 0 ? 0.8 : 0) + Math.random() * 0.05
        const t0 = process.hrtime.bigint()
        tempo.process(v)
        times.push(Number(process.hrtime.bigint() - t0))
      }
      const warm = times.slice(Math.floor(times.length / 2))
      const sorted = [...warm].sort((a, b) => a - b)
      const estimates = warm.filter((t) => t > sorted[Math.floor(sorted.length * 0.5)] * 10)
      const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0)
      rows.push({
        hop,
        hopRate,
        historyLen: Math.round(6 * hopRate),
        plainHopNs: sorted[Math.floor(sorted.length * 0.5)],
        estimateCount: estimates.length,
        estimateMedianNs: median(estimates),
        estimateMaxNs: Math.max(0, ...estimates),
        amortizedPerHopNs: warm.reduce((a, b) => a + b, 0) / warm.length,
      })
    }
    writeFileSync(`${OUT}/tempo-by-hoprate.json`, JSON.stringify(rows, null, 2))
    expect(rows.length).toBe(5)
  }, 900_000)

  it.runIf(Boolean(globalThis.gc))('allocation per hop', () => {
    const rows: Record<string, unknown>[] = []
    for (const { name, config } of SLOTS) {
      const analyzer = new Analyzer({ ...config, sampleRate: SAMPLE_RATE })
      const textures = new AudioTextures(config.bands, SAMPLE_RATE)
      let at = 0
      const nextHop = () => { at = (at + config.hop) % (track.length - config.hop); return track.subarray(at, at + config.hop) }
      for (let i = 0; i < 2000; i++) analyzer.process(nextHop())
      const onsets = new OnsetDetector(SAMPLE_RATE / config.hop)
      const bands = new Float32Array(config.bands)
      rows.push({
        slot: name,
        bytesPerHopProcess: allocPerCall(() => { analyzer.process(nextHop()) }),
        bytesPerHopProcessPlusTextures: allocPerCall(() => { const h = nextHop(); textures.push(h, analyzer.process(h)) }),
        bytesPerHopOnsetOnly: allocPerCall(() => { onsets.process(bands) }),
        subarrayViewBytes: allocPerCall(() => { nextHop() }),
        // the two Float32Array.reduce calls in OnsetDetector.process (spectral.ts:78-79) box a double per element
        recentLength: Math.max(8, Math.round(SAMPLE_RATE / config.hop)),
        reduceBytes: (() => {
          const recent = new Float32Array(Math.max(8, Math.round(SAMPLE_RATE / config.hop))).fill(0.3)
          let sink = 0
          return allocPerCall(() => {
            const mean = recent.reduce((a, b) => a + b, 0) / recent.length
            sink += Math.sqrt(recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length)
          })
        })(),
        reduceAsLoopBytes: (() => {
          const recent = new Float32Array(Math.max(8, Math.round(SAMPLE_RATE / config.hop))).fill(0.3)
          let sink = 0
          return allocPerCall(() => {
            let sum = 0
            for (let i = 0; i < recent.length; i++) sum += recent[i]
            const mean = sum / recent.length
            let variance = 0
            for (let i = 0; i < recent.length; i++) variance += (recent[i] - mean) ** 2
            sink += Math.sqrt(variance / recent.length)
          })
        })(),
        spreadMaxBytes: (() => { const b = new Float32Array(config.bands); let sink = 0; return allocPerCall(() => { sink += Math.max(...b) }) })(),
        typedArrayBackingStoresAreExternal: true,
      })
    }
    // known quantities, so the report can say how much the method is worth: a Float32Array object header is 200 B
    let sink: unknown
    const calibration = {
      noop: allocPerCall(() => {}),
      float32Array256: allocPerCall(() => { sink = new Float32Array(256) }),
      objectFourKeys: allocPerCall(() => { sink = { a: 1, b: 2, c: 3, d: 4 } }),
      sinkIsUsed: sink !== undefined,
    }
    writeFileSync(`${OUT}/alloc-audio.json`, JSON.stringify({ calibration, rows }, null, 2))
    expect(rows.length).toBe(4)
  }, 900_000)

  it.runIf(process.env.PERF_CPU_GC === '1')('60 s simulated run, for gc counting', async () => {
    const configs = SLOTS.map(({ config }) => ({ ...config, sampleRate: SAMPLE_RATE }))
    const slots = configs.map((config) => ({ config, analyzer: new Analyzer(config), textures: new AudioTextures(config.bands, SAMPLE_RATE), at: 0 }))
    const runner = { frames: 30 * 60 }
    // --trace-gc is refused in NODE_OPTIONS, so the pauses are counted through the performance GC entries instead
    const pauses: { kind: number; ms: number }[] = []
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) pauses.push({ kind: (entry as PerformanceEntry & { detail: { kind: number } }).detail.kind, ms: entry.duration })
    })
    observer.observe({ entryTypes: ['gc'] })
    const t0 = process.hrtime.bigint()
    for (let frame = 0; frame < runner.frames; frame++) {
      for (const slot of slots) {
        const perFrame = Math.round(SAMPLE_RATE / slot.config.hop / 30)
        for (let h = 0; h < perFrame; h++) {
          slot.at = (slot.at + slot.config.hop) % (track.length - slot.config.hop)
          const hop = track.subarray(slot.at, slot.at + slot.config.hop)
          slot.textures.push(hop, slot.analyzer.process(hop))
        }
      }
    }
    const wallMs = Number(process.hrtime.bigint() - t0) / 1e6
    // gc entries are delivered on a later tick, and the loop above never yields, so wait before disconnecting
    await new Promise((resolve) => setTimeout(resolve, 500))
    observer.disconnect()
    const byKind = pauses.reduce<Record<number, { count: number; ms: number }>>((acc, p) => {
      acc[p.kind] = { count: (acc[p.kind]?.count ?? 0) + 1, ms: (acc[p.kind]?.ms ?? 0) + p.ms }
      return acc
    }, {})
    writeFileSync(`${OUT}/gc-60s.json`, JSON.stringify({
      frames: runner.frames,
      wallMs,
      gcCount: pauses.length,
      gcTotalMs: pauses.reduce((a, p) => a + p.ms, 0),
      gcMaxMs: Math.max(0, ...pauses.map((p) => p.ms)),
      byKind,
    }, null, 2))
    expect(pauses.length).toBeGreaterThanOrEqual(0)
  }, 900_000)

  it('cpu profile of the worst-case slot set', async () => {
    const configs = SLOTS.map(({ config }) => ({ ...config, sampleRate: SAMPLE_RATE }))
    const slots = configs.map((config) => ({
      config,
      analyzer: new Analyzer(config),
      textures: new AudioTextures(config.bands, SAMPLE_RATE),
      at: 0,
    }))
    const run = (frames: number) => {
      for (let frame = 0; frame < frames; frame++) {
        for (const slot of slots) {
          const perFrame = Math.round(SAMPLE_RATE / slot.config.hop / 30)
          for (let h = 0; h < perFrame; h++) {
            slot.at = (slot.at + slot.config.hop) % (track.length - slot.config.hop)
            const hop = track.subarray(slot.at, slot.at + slot.config.hop)
            slot.textures.push(hop, slot.analyzer.process(hop))
          }
        }
      }
    }
    run(30)
    const session = new Session()
    session.connect()
    const post = (method: string, params?: object) => new Promise<{ profile?: unknown }>((resolve, reject) => {
      session.post(method as 'Profiler.enable', params as never, (err, res) => (err ? reject(err) : resolve(res as never)))
    })
    await post('Profiler.enable')
    await post('Profiler.setSamplingInterval', { interval: 100 })
    await post('Profiler.start')
    const t0 = process.hrtime.bigint()
    run(300)
    const wallMs = Number(process.hrtime.bigint() - t0) / 1e6
    const { profile } = await post('Profiler.stop')
    session.disconnect()
    writeFileSync(`${OUT}/audio-multi-fft.cpuprofile`, JSON.stringify(profile))
    writeFileSync(`${OUT}/audio-multi-fft-wall.json`, JSON.stringify({ frames: 300, wallMs, msPerFrame: wallMs / 300 }, null, 2))
    expect(wallMs).toBeGreaterThan(0)
  }, 900_000)
})
