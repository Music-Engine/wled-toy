import { describe, expect, it } from 'vitest'
import type { Features } from '@/lib/audio/dsp'
import type { NodeGraph, SocketValue } from '@/lib/graph/model/doc'
import { nodeItem } from '@/lib/graph/registry'
import { graph, node, toByte } from '@/lib/graph/testing'
import { cppCompiler, runUsermod } from '@/lib/graph/testing/cpp'
import { FPS, offlineAudio, SAMPLE_RATE, SECONDS } from '@/lib/graph/testing/offline'
import { glslCompiler, usermodCompiler } from '@/lib/graph/compile/next/compilers'

const FRAMES = SECONDS * FPS

interface Probe {
  kind: string
  values?: Record<string, SocketValue>
  /** Up to three outputs, shown on the red, green and blue of the one LED. */
  outputs: string[]
  /** An FFT node with these values feeds the probed node's spectrum. */
  fft?: Record<string, SocketValue>
}

function probeGraph({ kind, values = {}, outputs, fft }: Probe): NodeGraph {
  const nodes = [node('n', kind, values), node('c', 'combineXYZ'), node('o', 'output'), ...(fft ? [node('f', 'fft', fft)] : [])]
  const links: [string, string][] = [...outputs.map((output, i): [string, string] => [`n.${output}`, `c.${'xyz'[i]}`]), ['c.vector', 'o.color'], ...(fft ? [['f.spectrum', 'n.spectrum'] as [string, string]] : [])]
  return graph(nodes, links)
}

/** The probed outputs per frame through the usermod unit, and through the old frame body over the same analyses. */
function run(probe: Probe, inputs: Record<string, unknown> = {}, state?: Record<string, number>) {
  const doc = probeGraph(probe)
  const { analyses, feed } = offlineAudio(FRAMES, glslCompiler().compile(doc).program!.resources)
  const cpp = runUsermod(usermodCompiler(1).compile(doc).program!.code, { leds: 1, frames: FRAMES, feed }).map(([rgb]) => rgb.slice(0, probe.outputs.length))
  const frame = nodeItem(probe.kind)!.shape(probe.values ?? {}).frame!
  const old = analyses.map((taken: (Features | null)[], n) => {
    const info = { time: n / FPS, dt: 1 / FPS, frameIndex: n, audio: { analyses: taken, sampleRate: SAMPLE_RATE }, midi: undefined, osc: undefined, state, resolved: {} }
    const outputs = frame(inputs, info)
    return probe.outputs.map((output) => toByte(outputs[output] as number))
  })
  return { cpp, old }
}

describe('the audio kinds', () => {
  it('run in the frame pass alone, and read the audio arrays there', () => {
    for (const probe of [{ kind: 'audio', outputs: ['beat', 'kick'] }, { kind: 'bands', outputs: ['band1'] }, { kind: 'audioSignal', outputs: ['signal'] }, { kind: 'bandSplit', outputs: ['level'] }]) {
      const { frame, pixel } = glslCompiler().compile(probeGraph(probe)).program!
      expect(frame?.code, probe.kind).toMatch(/bandsPeak\(0, 0, 8\)|iAudioFeatures\[|spectrumPeak\(60\.0, 150\.0\)/)
      expect(pixel, probe.kind).not.toMatch(/bandsPeak|iAudioFeatures|spectrumPeak/)
    }
  })

  it('map a Bands node on an FFT with other settings to its slot, and that slot to iAudioBandsExtra', () => {
    const { frame, resources } = glslCompiler().compile(probeGraph({ kind: 'bands', outputs: ['band1'], fft: { bands: 32 } })).program!
    expect(resources.analysis).toHaveLength(1)
    expect(frame!.code).toContain('bandsPeak(1, 0, 8)')
    expect(frame!.code).toContain('if (slot == 1) return texture(iAudioBandsExtra[0], vec2(x, 0.25)).r;')
  })
})

describe.skipIf(!cppCompiler)('the audio kinds through the usermod target over the synthetic track (needs g++ or c++ on PATH)', () => {
  it.each([4, 16])('Bands at %i reads per frame what its old frame body read', (count) => {
    for (let first = 0; first < count; first += 3) {
      const outputs = Array.from({ length: Math.min(3, count - first) }, (_, i) => `band${first + i + 1}`)
      const { cpp, old } = run({ kind: 'bands', values: { count: String(count) }, outputs }, { spectrum: { slot: 0 } })
      expect(old.some((bytes) => bytes.some((byte) => byte > 0)), 'the track reaches the bands').toBe(true)
      expect(cpp).toEqual(old)
    }
  }, 120_000)

  it('Bands on an extra FFT reads that slot as its old frame body did', () => {
    const { cpp, old } = run({ kind: 'bands', values: { count: '4' }, outputs: ['band1', 'band2', 'band3'], fft: { bands: 32 } }, { spectrum: { slot: 1 } })
    expect(old.some((bytes) => bytes.some((byte) => byte > 0)), 'the track reaches the bands').toBe(true)
    expect(cpp).toEqual(old)
  }, 60_000)

  it('Audio pulses the beat on the frames and follows the kick as its old frame body did', () => {
    const { cpp, old } = run({ kind: 'audio', outputs: ['beat', 'kick', 'onset'] })
    expect(old.filter(([beat]) => beat === 255).length, 'the track has beats').toBeGreaterThan(4)
    expect(cpp).toEqual(old)
  }, 60_000)

  it.each([[60, 150], [6000, 16000]])('Band Split from %i to %i Hz reads per frame what its old frame body read', (low, high) => {
    const { cpp, old } = run({ kind: 'bandSplit', values: { low, high }, outputs: ['level'] }, { spectrum: { slot: 0 }, low, high })
    expect(old.some(([level]) => level > 0), 'the track reaches the range').toBe(true)
    expect(cpp).toEqual(old)
  }, 60_000)

  it('Audio to Signal follows each measure with attack and release as its old frame body did', () => {
    for (const mode of ['level', 'rms', 'peak']) {
      const { cpp, old } = run({ kind: 'audioSignal', values: { mode }, outputs: ['signal'] }, { mode, attack: 0.01, release: 0.15 }, { value: 0 })
      expect(old.some(([signal]) => signal > 0), mode).toBe(true)
      cpp.forEach(([signal], n) => expect(Math.abs(signal - old[n][0]), `${mode} frame ${n}`).toBeLessThanOrEqual(1))
    }
  }, 120_000)
})
