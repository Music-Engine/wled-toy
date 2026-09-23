import { describe, expect, it } from 'vitest'
import { FrameRunner, generateGlsl, itemFor } from '@/lib/graph'
import { graph, node } from '@/lib/graph/testing'

const features = (patch: { level?: number; rms?: number; peak?: number }) => ({ level: 0, rms: 0, peak: 0, ...patch }) as never

describe('Audio to Signal', () => {
  it('follows the chosen measure with attack and release, as a per-frame number', () => {
    const doc = (values: object) => graph([node('s', 'audioSignal', values as never), node('o', 'output')], [['s.signal', 'o.color']])
    const run = (values: object, script: number[]) => {
      const { control, error } = generateGlsl(doc(values))
      expect(error).toBeNull()
      const runner = new FrameRunner()
      runner.load(control)
      return script.map((peak, n) => runner.step({ time: n / 30, dt: 1 / 30, frameIndex: n, audio: { analyses: [features({ peak, rms: peak / 2, level: peak })], sampleRate: 48000 } })[0])
    }
    expect(run({ mode: 'peak', attack: 0 }, [0.8])[0]).toBeCloseTo(0.8, 5)
    expect(run({ mode: 'rms', attack: 0 }, [0.8])[0]).toBeCloseTo(0.4, 5)
    const fall = run({ mode: 'level', attack: 0, release: 0.3 }, [1, ...Array(9).fill(0)])
    expect(fall[0]).toBe(1)
    expect(fall[9]).toBeLessThan(fall[8])
    expect(fall[9]).toBeGreaterThan(0.2)
  })

  it('stands in for a prelude helper when the code goes to shader mode', () => {
    const { code } = generateGlsl(graph([node('s', 'audioSignal'), node('o', 'output')], [['s.signal', 'o.color']]), { standalone: true })
    expect(code).toContain('energy()')
  })
})

describe('Distance From Center', () => {
  it('is 0 at the center and 1 at the far end, on both sides', () => {
    const run = itemFor('fromCenter')!.base.run!
    const at = (position: number, center = 0.5) => run({ position, center }, undefined, { time: 0, dt: 0, frameIndex: 0 }).distance
    expect([at(0.5), at(0), at(1), at(0.75)]).toEqual([0, 1, 1, 0.5])
    expect([at(0.25, 0.25), at(1, 0.25), at(0, 0.25)]).toEqual([0, 1, 1 / 3])
    const { code } = generateGlsl(graph([node('f', 'fromCenter'), node('o', 'output')], [['f.distance', 'o.color']]))
    expect(code).toContain('abs(uv.x - 0.5)')
  })
})
