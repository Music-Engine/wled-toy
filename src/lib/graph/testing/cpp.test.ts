import { describe, expect, it } from 'vitest'
import { graph, node } from '@/lib/graph/testing'
import { cppCompiler, runOffline, runUsermod } from './cpp'
import { readUsermodBands } from './offline'

describe.skipIf(!cppCompiler)('runOffline and runUsermod (needs g++ or c++ on PATH)', () => {
  it('feeds the synthetic track to iAudioBands, which Audio Band averages at its eight sample points', () => {
    const frames = 60
    const feed = readUsermodBands(frames)
    const rendered = runOffline(graph([node('b', 'bandLevel', { low: 0, high: 1 }), node('o', 'output')], [['b.out', 'o.color']]), {
      leds: 1,
      frames,
      feed: feed.map((bands) => ({ bands: [bands] })),
    })
    // bandLevel(0, 1) samples fft at (i + 0.5) / 8: odd band centers
    const expected = feed.map((bands) => Math.round((bands.filter((_, band) => band % 2 === 1).reduce((a, b) => a + b) / 8) * 255))
    expect(
      expected.some((level) => level > 0),
      'the track reaches the bands',
    ).toBe(true)
    rendered.forEach(([[r, g, b]], frame) => {
      expect(Math.abs(r - expected[frame]), `frame ${frame}`).toBeLessThanOrEqual(1)
      expect([g, b]).toEqual([r, r])
    })
  }, 60_000)

  it('pushes one history row per slot and the new samples each frame, which historyAt and waveformAt read back', () => {
    const unit = [
      '#include "wledtoy.h"',
      'namespace wledtoy {',
      'constexpr int ledCount = 3;',
      'void renderFrame(float, int, vec3* colors) {',
      '  colors[0] = vec3(historyAt(0, 0.5f / 16.0f, 0.0f));',
      '  colors[1] = vec3(historyAt(0, 0.5f / 16.0f, 1.0f / float(audioHistoryRows - 1)));',
      '  colors[2] = vec3(waveformAt(0.0f) * 0.5f + 0.5f);',
      '}',
      '}',
    ].join('\n')
    const feed = [0.2, 0.4, 0.6].map((level, frame) => ({ bands: [[level, ...new Array(15).fill(0)]], samples: [0, frame / 2] }))
    const rendered = runUsermod(unit, { leds: 3, frames: 3, feed })
    expect(rendered.map((leds) => leds.map(([r]) => r))).toEqual([
      [51, 0, 128],
      [102, 51, 191],
      [153, 102, 255],
    ])
  }, 60_000)

  it('renders one row of LED bytes per frame', () => {
    const rendered = runOffline(graph([node('uv', 'uv'), node('o', 'output')], [['uv.x', 'o.color']]), { leds: 4, frames: 3 })
    expect(rendered).toEqual(Array(3).fill([0, 1, 2, 3].map((i) => Array(3).fill(Math.round(((i + 0.5) / 4) * 255)))))
  }, 60_000)

  it('throws what the compile reported when it withholds the unit', () => {
    expect(() => runOffline(graph([node('m', 'midiIn'), node('o', 'output')], [['m.value', 'o.color']]), { leds: 1, frames: 1 })).toThrow(
      'MIDI In reads MIDI, which a usermod has no input for',
    )
  })

  it('returns no frames for frames: 0 and empty frames for leds: 0', () => {
    const doc = graph([node('uv', 'uv'), node('o', 'output')], [['uv.x', 'o.color']])
    expect(runOffline(doc, { leds: 4, frames: 0 })).toEqual([])
    expect(runOffline(doc, { leds: 0, frames: 3 })).toEqual([[], [], []])
  }, 60_000)
})
