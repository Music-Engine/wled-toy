import { describe, expect, it } from 'vitest'
import { buildCpp, cppCompiler, runOffline } from '@/lib/graph/testing/cpp'
import { glslCompiler, usermodCompiler } from './compilers'
import { corpusGraphs, corpusKinds } from './corpus'

const graphs = corpusGraphs()
const kinds = corpusKinds()
const LEDS = 8

// the host's side of the unit for one frame at time 0, as runOffline prints it
const ONE_FRAME = [
  '#include <cstdio>',
  'int main() {',
  '  static wledtoy::vec3 colors[wledtoy::ledCount];',
  '  wledtoy::renderFrame(0.0f, 0, colors);',
  '  for (const wledtoy::vec3& c : colors) std::printf("%d %d %d ", int(c.x * 255.0f + 0.5f), int(c.y * 255.0f + 0.5f), int(c.z * 255.0f + 0.5f));',
  '}',
  '',
]

describe.skipIf(!cppCompiler)('the usermod target (needs g++ or c++ on PATH)', () => {
  // a B-spline Color Ramp declares a GLSL array constructor, which the header has no form for
  it('builds every program of the gate corpus with the cpp job\'s flags but the one with a B-spline Color Ramp', () => {
    const units = [...graphs, ...kinds].flatMap(([name, doc]) => {
      const code = usermodCompiler(LEDS).compile(doc).program?.code
      return code ? [[name, code] as const] : []
    })
    const failed = units.filter(([, code]) => buildCpp(code, { run: false }).status !== 0).map(([name]) => name)
    expect(units).toHaveLength(2 + 2 + kinds.length)
    expect(failed).toEqual(['bench-gpu-heavy'])
  }, 120_000)

  it('shades a kind whose frame pass feeds the pixel pass as the old pipeline did per pixel', () => {
    const framed = kinds.filter(([, doc]) => glslCompiler().compile(doc).program?.frame)
    expect(framed.map(([name]) => name)).toEqual(['time', 'math', 'vectorMath', 'combineXYZ', 'wave'])
    for (const [name, doc] of framed) {
      const { output } = buildCpp(`${usermodCompiler(LEDS).compile(doc).program!.code}${ONE_FRAME.join('\n')}`, { run: true })
      const bytes = output.trim().split(' ').map(Number)
      expect(bytes, name).toEqual(runOffline(doc, { leds: LEDS, frames: 1 })[0].flat())
    }
  }, 120_000)
})
