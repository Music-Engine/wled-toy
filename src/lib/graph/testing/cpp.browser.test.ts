import { describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { readGraphFile } from '@/lib/graph/model/file'
import { renderGraph } from '@/lib/graph/testing'
import baseline from '/graphs/bench/bench-baseline.wledgraph?raw'
import { FPS } from './offline'

const compiler = await commands.cppCompiler()

describe.skipIf(!compiler)('runOffline against WebGL (needs g++ or c++ on PATH)', () => {
  it('renders bench-baseline for 30 frames within one byte per channel of the WebGL render', async () => {
    const doc = readGraphFile(baseline).doc
    const [leds, frames] = [60, 30]
    const cpp = await commands.runOffline(doc, { leds, frames })
    const webgl = Array.from({ length: frames }, (_, frame) => renderGraph(doc, { leds, time: frame / FPS, frame }).leds)
    expect(cpp).toHaveLength(frames)
    cpp.forEach((rendered, frame) => rendered.forEach((led, i) => led.forEach((channel, c) => {
      expect(Math.abs(channel - webgl[frame][i][c]), `frame ${frame} LED ${i} channel ${c}`).toBeLessThanOrEqual(1)
    })))
  }, 60_000)
})
