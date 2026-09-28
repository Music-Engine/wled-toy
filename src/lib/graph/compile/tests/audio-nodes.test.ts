import { describe, expect, it } from 'vitest'
import { AUDIO_FEATURES } from '@/lib/audio/features'
import type { NodeGraph, SocketValue } from '@/lib/graph/model/doc'
import { graph, node, toByte } from '@/lib/graph/testing'
import { cppCompiler, runUsermod, type AudioFrame } from '@/lib/graph/testing/cpp'
import { FPS, feedOfflineAudio, SAMPLE_RATE, SECONDS } from '@/lib/graph/testing/offline'
import { createGlslCompiler, createUsermodCompiler } from '@/lib/graph/compile/compilers'

const FRAMES = SECONDS * FPS

interface Probe {
  kind: string
  values?: Record<string, SocketValue>
  /** Up to three, on the one LED's red, green, blue */
  outputs: string[]
  /** FFT values feeding the probed node's spectrum */
  fft?: Record<string, SocketValue>
}

function buildProbeGraph({ kind, values = {}, outputs, fft }: Probe): NodeGraph {
  const nodes = [node('n', kind, values), node('c', 'combineXYZ'), node('o', 'output'), ...(fft ? [node('f', 'fft', fft)] : [])]
  const links: [string, string][] = [...outputs.map((output, i): [string, string] => [`n.${output}`, `c.${'xyz'[i]}`]), ['c.vector', 'o.color'], ...(fft ? [['f.spectrum', 'n.spectrum'] as [string, string]] : [])]
  return graph(nodes, links)
}

/** Probed outputs per frame via the usermod unit, and what the host uploaded per frame of the synthetic track */
function runProbe(probe: Probe): { cpp: number[][]; feed: AudioFrame[] } {
  const doc = buildProbeGraph(probe)
  const feed = feedOfflineAudio(FRAMES, createGlslCompiler().compile(doc).program!.resources)
  const cpp = runUsermod(createUsermodCompiler(1).compile(doc).program!.code, { leds: 1, frames: FRAMES, feed }).map(([rgb]) => rgb.slice(0, probe.outputs.length))
  return { cpp, feed }
}

/** Uploaded feature by name, as the Audio node reads it */
const readFeature = (frame: AudioFrame, name: string) => frame.features![AUDIO_FEATURES.indexOf(name as never)]

/** Loudest uploaded band that output `band` of `count` covers, as bandsPeak folds them */
function foldBands(row: ArrayLike<number>, band: number, count: number): number {
  const from = Math.floor((band * 16) / count)
  const to = Math.max(from + 1, Math.floor(((band + 1) * 16) / count))
  return Math.max(...Array.from(row).slice(from, to))
}

/** Loudest uploaded bin between `low` and `high` Hz incl. the bins either side, as spectrumPeak reads it */
function findSpectrumPeak(bins: ArrayLike<number>, low: number, high: number): number {
  const hz = SAMPLE_RATE / (2 * bins.length)
  const last = Math.min(bins.length - 1, Math.ceil(Math.max(low, high) / hz))
  let peak = 0
  for (let i = Math.max(1, Math.floor(Math.min(low, high) / hz)); i <= last; i++) peak = Math.max(peak, bins[i])
  return peak
}

describe('the audio kinds', () => {
  it('run the bin loops and the follower in the frame pass alone, and read the audio arrays there', () => {
    for (const probe of [{ kind: 'bands', outputs: ['band1'] }, { kind: 'audioSignal', outputs: ['signal'] }, { kind: 'bandSplit', outputs: ['level'] }]) {
      const { frame, pixel } = createGlslCompiler().compile(buildProbeGraph(probe)).program!
      expect(frame?.code, probe.kind).toMatch(/bandsPeak\(0, 0, 8\)|iAudioFeatures\[|spectrumPeak\(0, 60\.0, 150\.0\)/)
      expect(pixel, probe.kind).not.toMatch(/bandsPeak|iAudioFeatures|spectrumPeak/)
    }
  })

  it('read the Audio node features as uniforms in the pixel pass, w/o a frame pass', () => {
    const { frame, pixel } = createGlslCompiler().compile(buildProbeGraph({ kind: 'audio', outputs: ['beat', 'kick'] })).program!
    expect(frame).toBeNull()
    expect(pixel).toMatch(/iAudioFeatures\[/)
  })

  it('map a Bands node on an FFT with other settings to its slot, and that slot to iAudioBandsExtra', () => {
    const { frame, resources } = createGlslCompiler().compile(buildProbeGraph({ kind: 'bands', outputs: ['band1'], fft: { bands: 32 } })).program!
    expect(resources.analysis).toHaveLength(1)
    expect(frame!.code).toContain('bandsPeak(1, 0, 8)')
    expect(frame!.code).toContain('if (slot == 1) return texture(iAudioBandsExtra[0], vec2(x, 0.25)).r;')
  })
})

describe.skipIf(!cppCompiler)('the audio kinds through the usermod target over the synthetic track (needs g++ or c++ on PATH)', () => {
  it.each([4, 16])('Bands at %i folds the uploaded bands per frame', (count) => {
    for (let first = 0; first < count; first += 3) {
      const outputs = Array.from({ length: Math.min(3, count - first) }, (_, i) => `band${first + i + 1}`)
      const { cpp, feed } = runProbe({ kind: 'bands', values: { count: String(count) }, outputs })
      const want = feed.map((frame) => outputs.map((_, i) => toByte(foldBands(frame.bands![0], first + i, count))))
      expect(want.some((bytes) => bytes.some((byte) => byte > 0)), 'the track reaches the bands').toBe(true)
      expect(cpp).toEqual(want)
    }
  }, 120_000)

  it('Bands on an extra FFT reads that slot', () => {
    const { cpp, feed } = runProbe({ kind: 'bands', values: { count: '4' }, outputs: ['band1', 'band2', 'band3'], fft: { bands: 32 } })
    const want = feed.map((frame) => [0, 1, 2].map((band) => toByte(foldBands(frame.bands![1], band, 4))))
    expect(want.some((bytes) => bytes.some((byte) => byte > 0)), 'the track reaches the bands').toBe(true)
    expect(cpp).toEqual(want)
  }, 60_000)

  it('Audio pulses the beat on the frames and follows the kick as uploaded', () => {
    const { cpp, feed } = runProbe({ kind: 'audio', outputs: ['beat', 'kick', 'onset'] })
    const want = feed.map((frame) => ['beat', 'kick', 'onset'].map((name) => toByte(readFeature(frame, name))))
    expect(want.filter(([beat]) => beat === 255).length, 'the track has beats').toBeGreaterThan(4)
    expect(cpp).toEqual(want)
  }, 60_000)

  it.each([[60, 150], [6000, 16000]])('Band Split from %i to %i Hz reads the loudest uploaded bin of its range per frame', (low, high) => {
    const { cpp, feed } = runProbe({ kind: 'bandSplit', values: { low, high }, outputs: ['level'] })
    const want = feed.map((frame) => [toByte(findSpectrumPeak(frame.spectrum![0], low, high))])
    expect(want.some(([level]) => level > 0), 'the track reaches the range').toBe(true)
    cpp.forEach(([level], n) => expect(Math.abs(level - want[n][0]), `frame ${n}`).toBeLessThanOrEqual(1))
  }, 60_000)

  it('Band Split on an extra FFT reads that slot\'s spectrum', () => {
    const { frame } = createGlslCompiler().compile(buildProbeGraph({ kind: 'bandSplit', outputs: ['level'], fft: { window: 'blackman' } })).program!
    expect(frame!.code).toContain('spectrumPeak(1, 60.0, 150.0)')
    const { cpp, feed } = runProbe({ kind: 'bandSplit', values: { low: 60, high: 150 }, outputs: ['level'], fft: { window: 'blackman' } })
    const want = feed.map((frame) => [toByte(findSpectrumPeak(frame.spectrum![1], 60, 150))])
    expect(want.some(([level]) => level > 0), 'the track reaches the range').toBe(true)
    cpp.forEach(([level], n) => expect(Math.abs(level - want[n][0]), `frame ${n}`).toBeLessThanOrEqual(1))
  }, 60_000)

  it('Audio to Signal follows each measure with attack and release', () => {
    const [attack, release] = [0.01, 0.15]
    for (const mode of ['level', 'rms', 'peak']) {
      const { cpp, feed } = runProbe({ kind: 'audioSignal', values: { mode, attack, release }, outputs: ['signal'] })
      let value = 0
      const want = feed.map((frame) => {
        const target = readFeature(frame, mode)
        const seconds = target > value ? attack : release
        value += (target - value) * (seconds <= 0 ? 1 : 1 - Math.exp(-1 / FPS / seconds))
        return toByte(value)
      })
      expect(want.some((signal) => signal > 0), mode).toBe(true)
      cpp.forEach(([signal], n) => expect(Math.abs(signal - want[n]), `${mode} frame ${n}`).toBeLessThanOrEqual(1))
    }
  }, 120_000)
})
