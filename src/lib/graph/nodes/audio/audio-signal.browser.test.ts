import { describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import type { Features } from '@/lib/audio/dsp'
import { computeAudioFeatures } from '@/lib/audio/features'
import { createGlslCompiler } from '@/lib/graph'
import { graph, node, renderGraph } from '@/lib/graph/testing'

const compiler = await commands.cppCompiler()

// Host's iAudioFeatures for a gated-off analysis w/ these three measures
const toFeatureRow = ({ level = 0, rms = 0, peak = 0 }) =>
  Array.from(computeAudioFeatures({ level, rms, peak, gate: false, onset: false, beat: false, beatPhase: 0, bpm: 120, centroid: 0, flatness: 0 } as Features, 48000))

describe.skipIf(!compiler)('Audio to Signal (needs g++ or c++ on PATH)', () => {
  it('follows the chosen measure with attack and release, one step per frame', async () => {
    const buildDoc = (values: object) => graph([node('s', 'audioSignal', values as never), node('o', 'output')], [['s.signal', 'o.color']])
    const runScript = async (values: object, script: number[]) => {
      const { program, issues } = await renderGraph(buildDoc(values), { leds: 1 })
      expect(issues).toEqual([])
      const feed = script.map((peak) => ({ features: toFeatureRow({ peak, rms: peak / 2, level: peak }) }))
      return (await commands.runUsermod(program!.code, { leds: 1, frames: script.length, feed })).map(([[red]]) => red / 255)
    }
    expect((await runScript({ mode: 'peak', attack: 0 }, [0.8]))[0]).toBeCloseTo(0.8, 2)
    expect((await runScript({ mode: 'rms', attack: 0 }, [0.8]))[0]).toBeCloseTo(0.4, 2)
    const fall = await runScript({ mode: 'level', attack: 0, release: 0.3 }, [1, ...Array(9).fill(0)])
    expect(fall[0]).toBe(1)
    expect(fall[9]).toBeLessThan(fall[8])
    expect(fall[9]).toBeGreaterThan(0.2)
  }, 30_000)
})

describe('Audio to Signal in shader mode', () => {
  it('reads the uploaded features and says that the exported shader keeps no memory', () => {
    const { program, issues } = createGlslCompiler({ standalone: true }).compile(graph([node('s', 'audioSignal'), node('o', 'output')], [['s.signal', 'o.color']]))
    expect(program!.pixel).toContain('iAudioFeatures')
    expect(issues.map((issue) => issue.nodeId)).toEqual(['s'])
    expect(issues[0].message).toContain('keeps no memory')
  })
})

describe.skipIf(!compiler)('Distance From Center (needs g++ or c++ on PATH)', () => {
  it('is 0 at the center and 1 at the far end, on both sides', async () => {
    const renderAt = async (position: number, center = 0.5) =>
      (await renderGraph(graph([node('f', 'fromCenter', { position, center }), node('o', 'output')], [['f.distance', 'o.color']]), { leds: 1 })).leds[0][0]
    expect([await renderAt(0.5), await renderAt(0), await renderAt(1), await renderAt(0.75)]).toEqual([0, 255, 255, 128])
    expect([await renderAt(0.25, 0.25), await renderAt(1, 0.25), await renderAt(0, 0.25)]).toEqual([0, 255, 85])
    const { program } = createGlslCompiler().compile(graph([node('f', 'fromCenter'), node('o', 'output')], [['f.distance', 'o.color']]))
    expect(program!.pixel).toContain('abs(uv.x - 0.5)')
  }, 60_000)
})
