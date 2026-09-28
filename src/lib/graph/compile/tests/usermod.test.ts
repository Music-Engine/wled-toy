import { describe, expect, it } from 'vitest'
import { buildCpp, cppCompiler } from '@/lib/graph/testing/cpp'
import { createUsermodCompiler } from '@/lib/graph/compile/compilers'
import { listCorpusGraphs, listCorpusKinds } from '@/lib/graph/compile/corpus'

const graphs = listCorpusGraphs()
const kinds = listCorpusKinds()
const LEDS = 8

describe.skipIf(!cppCompiler)('the usermod target (needs g++ or c++ on PATH)', () => {
  // bench-gpu-heavy withheld: B-spline Color Ramp declares a GLSL array constructor
  it('builds every program of the gate corpus it compiles with the cpp job\'s flags', () => {
    const units = [...graphs, ...kinds].flatMap(([name, doc]) => {
      const code = createUsermodCompiler(LEDS).compile(doc).program?.code
      return code ? [[name, code] as const] : []
    })
    const failed = units.filter(([, code]) => buildCpp(code).status !== 0).map(([name]) => name)
    const without = kinds.filter(([name]) => !units.some(([unit]) => unit === name)).map(([name]) => name)
    expect(units.map(([name]) => name).filter((name) => graphs.some(([graph]) => graph === name))).toEqual(['bench-baseline', 'bench-control-chain', 'bench-gpu-shared-subgraph', 'bench-wide', 'high-contrast-music'])
    // Texture or GLSL-only reads, MIDI or OSC, or host readback
    expect(without).toEqual(['texture', 'chroma', 'midiIn', 'oscIn', 'sceneSwitch', 'viewer', 'trails', 'stripBlur', 'previousFrame', 'imageTexture'])
    expect(failed).toEqual([])
  }, 120_000)
})
