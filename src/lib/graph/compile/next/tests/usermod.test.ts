import { describe, expect, it } from 'vitest'
import { nodeItem } from '@/lib/graph/registry'
import { generateGlsl } from '@/lib/graph/compile/compile'
import { buildCpp, cppCompiler, runOffline } from '@/lib/graph/testing/cpp'
import { glslCompiler, usermodCompiler } from '@/lib/graph/compile/next/compilers'
import { corpusGraphs, corpusKinds } from '@/lib/graph/compile/next/corpus'

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
    const without = kinds.filter(([name]) => !units.some(([unit]) => unit === name)).map(([name]) => name)
    expect(units.map(([name]) => name).filter((name) => graphs.some(([graph]) => graph === name))).toEqual(['bench-baseline', 'bench-control-chain', 'bench-gpu-heavy', 'bench-gpu-shared-subgraph', 'bench-wide'])
    // these sample a texture, read MIDI or OSC, or are read back by the host
    expect(without).toEqual(['texture', 'spectrum', 'waveform', 'chroma', 'midiIn', 'oscIn', 'sceneSwitch', 'viewer', 'trails', 'stripBlur', 'previousFrame', 'imageTexture'])
    expect(failed).toEqual(['bench-gpu-heavy'])
  }, 120_000)

  // the old pipeline has no C++ for a stateful kind; signal-nodes.test.ts checks those against their frame bodies
  it('shades a stateless kind whose frame pass feeds the pixel pass as the old pipeline did per pixel', () => {
    const framed = kinds.filter(([name, doc]) => !nodeItem(name)!.base.state && glslCompiler().compile(doc).program?.frame && usermodCompiler(LEDS).compile(doc).program && generateGlsl(doc).frame.steps.length === 0)
    expect(framed.map(([name]) => name)).toEqual([
      'iResolution', 'iLedCount', 'iScanY', 'color', 'colorMix', 'layerMix', 'hueSaturation', 'brightnessCeiling', 'brightnessContrast',
      'gamma', 'invert', 'rgb2hsv', 'separateColor', 'combineColor', 'time', 'math', 'vectorMath', 'combineXYZ', 'value', 'vector2', 'wave',
    ])
    for (const [name, doc] of framed) {
      const { output } = buildCpp(`${usermodCompiler(LEDS).compile(doc).program!.code}${ONE_FRAME.join('\n')}`, { run: true })
      const bytes = output.trim().split(' ').map(Number)
      expect(bytes, name).toEqual(runOffline(doc, { leds: LEDS, frames: 1 })[0].flat())
    }
  }, 120_000)
})
