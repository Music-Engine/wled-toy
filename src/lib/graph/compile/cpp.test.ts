import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { NodeGraph } from '@/lib/graph/model/doc'
import { readGraphFile } from '@/lib/graph/model/file'
import { allItems, nodeItem } from '@/lib/graph/registry'
import { alone, graph, node } from '@/lib/graph/testing'
import { buildCpp, cppCompiler } from '@/lib/graph/testing/cpp'
import { buildProgram, type CompileOptions } from './compile'
import { cpp } from './cpp'
import { cppUnit } from './cpp-unit'
import { glsl } from './glsl'
import { GraphError } from './program'

// the registry has no hook for kinds of its own, so the test kinds are served beside the catalog
vi.mock('@/lib/graph/registry', async (importOriginal) => {
  const registry = await importOriginal<typeof import('@/lib/graph/registry')>()
  const { Color, defineNode, Float, swizzle } = await import('@/lib/graph/authoring')
  const kinds = [
    defineNode('stateFloat', {
      title: 'State Float', description: 'test', category: 'signal', stateScope: 'pixel',
      input: { rate: Float }, output: { value: Float }, state: { value: Float },
      pixel: ({ rate }, ctx) => {
        ctx.emit(`${ctx.state.value.expr} += ${rate.expr};`)
        return { value: ctx.state.value }
      },
    }),
    defineNode('stateColor', {
      title: 'State Color', description: 'test', category: 'signal', stateScope: 'pixel',
      input: { color: Color }, output: { color: Color }, state: { tint: Color },
      pixel: ({ color }, ctx) => {
        ctx.emit(`${ctx.state.tint.expr} = mix(${ctx.state.tint.expr}, ${color.expr}, 0.5);`)
        return { color: ctx.state.tint }
      },
    }),
    // the float slot pushes the color to .yzw, so a component of it is a component of a run
    defineNode('stateComponent', {
      title: 'State Component', description: 'test', category: 'signal', stateScope: 'pixel',
      input: { rate: Float }, output: { value: Float }, state: { count: Float, tint: Color },
      pixel: ({ rate }, ctx) => {
        ctx.emit(`${ctx.state.tint.expr}.y += ${rate.expr};`)
        return { value: swizzle(ctx.state.tint, 'x') }
      },
    }),
  ]
  return { ...registry, nodeItem: (kind: string) => kinds.find((item) => item.id === kind) ?? registry.nodeItem(kind) }
})

const integrated = graph([node('i', 'integrator'), node('m', 'math', { op: 'multiply', b: 0.375 }), node('o', 'output')], [['i.value', 'm.a'], ['m.result', 'o.color']])
// a float slot, then a color that fills the rest of the first layer, then a color in the second
const stateful = graph([node('a', 'stateFloat'), node('b', 'stateColor'), node('c', 'stateColor'), node('o', 'output')], [['a.value', 'b.color'], ['b.color', 'c.color'], ['c.color', 'o.color']])

describe('cpp', () => {
  it('writes one unit against the header, with the pixel function, the frozen values and the per-frame function', () => {
    const code = cpp(buildProgram(integrated, { standalone: true, controls: () => 0.25 }), { leds: 30 })
    expect(code).toMatch(/^#include "wledtoy.h"\n\nnamespace wledtoy \{\n/)
    expect(code).toContain('constexpr int ledCount = 30;')
    expect(code).toContain('void mainImage(vec4& c, vec2 uv, float ledIndex) {')
    expect(code).toContain('[[maybe_unused]] float n_m = 0.25 * 0.375;')
    expect(code).toContain('void renderFrame(float time, int frameIndex, vec3* colors) {')
    expect(code).not.toMatch(/iControl|pixelState/)
  })

  it('rejects a Program with frame steps, naming the first frame node', () => {
    const run = () => cpp(buildProgram(integrated, {}), { leds: 30 })
    expect(run).toThrow(GraphError)
    expect(run).toThrow('Integrator runs once per frame in JavaScript, which the C++ backend cannot run')
    expect(() => run()).toThrow(expect.objectContaining({ nodeId: 'i' }))
  })

  it('rejects a body that samples a texture', () => {
    const doc = graph([node('p', 'previousFrame'), node('o', 'output')], [['p.color', 'o.color']])
    expect(() => cpp(buildProgram(doc, {}), { leds: 30 })).toThrow(expect.objectContaining({ nodeId: 'p' }))
  })

  it('keeps pixel state as one set of state layers per LED, and writes a run of components through stateSlot', () => {
    const code = cpp(buildProgram(stateful, {}), { leds: 60 })
    expect(code).toContain('vec4 pixelState[ledCount][2] = {};')
    expect(code).toContain('[[maybe_unused]] vec4& outState1 = pixelState[int(ledIndex)][0];')
    expect(code).toContain('[[maybe_unused]] vec4& outState2 = pixelState[int(ledIndex)][1];')
    expect(code).toContain('outState1.x += ')
    expect(code).toContain('stateSlot<vec3>{outState1, 1} = mix(stateSlot<vec3>{outState1, 1}, ')
    expect(code).toContain('stateSlot<vec3>{outState2, 0} = ')
    expect(code).not.toMatch(/iState|texelFetch|layout\(/)
  })

  it.skipIf(!cppCompiler)('compiles the pixel state unit with the cpp job\'s flags (needs g++ or c++ on PATH)', () => {
    const { status, output } = buildCpp(cpp(buildProgram(stateful, {}), { leds: 60 }), { run: false })
    expect(status, output).toBe(0)
  })

  it.skipIf(!cppCompiler)('builds a pixel-scope kind into the C++ unit with its state read per LED, and compiles it (needs g++ or c++ on PATH)', () => {
    const { code } = cppUnit([nodeItem('stateColor')!])
    expect(code).toContain('vec4 pixelState[ledCount][1] = {};')
    expect(code).not.toMatch(/iState|outState\d+;/)
    const { status, output } = buildCpp(code.replace('#include "../wledtoy.h"', '#include "wledtoy.h"'), { run: false })
    expect(status, output).toBe(0)
  })

  it.skipIf(!cppCompiler)('reads and writes one component of a multi-float state slot (needs g++ or c++ on PATH)', () => {
    const doc = graph([node('s', 'stateComponent'), node('o', 'output')], [['s.value', 'o.color']])
    const code = cpp(buildProgram(doc, {}), { leds: 60 })
    expect(code).toContain('stateSlot<vec3>{outState1, 1}.y += ')
    expect(code).toContain('stateSlot<vec3>{outState1, 1}.x')
    const { status, output } = buildCpp(code, { run: false })
    expect(status, output).toBe(0)
  })

  it('reads only the Program, never the graph document', () => {
    expect(readFileSync('src/lib/graph/compile/cpp.ts', 'utf8')).not.toMatch(/NodeGraph/)
  })
})

const corpus: [string, NodeGraph][] = [
  ...readdirSync('graphs', { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.wledgraph'))
    .map((file): [string, NodeGraph] => [file, readGraphFile(readFileSync(`graphs/${file}`, 'utf8')).doc]),
  ...allItems().map((item): [string, NodeGraph] => [`kind ${item.id}`, alone(item)]),
]

/** What cpp makes of one gate case, and whether its Program would also have been rejected for the other reason. */
function outcome(doc: NodeGraph, options: CompileOptions): { result: string; both: boolean } {
  const probe = buildProgram(doc, options)
  glsl(probe)
  const both = probe.frame.length > 0 && Object.values(probe.nodes).some((n) => n.requires?.includes('glsl'))
  try {
    cpp(buildProgram(doc, options), { leds: 60 })
    return { result: 'accepted', both }
  } catch (err) {
    const { message } = err as Error
    if (message.includes('runs once per frame')) return { result: 'frame', both }
    if (message.includes('samples a texture')) return { result: 'glsl', both }
    return { result: message, both }
  }
}

function tally(options: CompileOptions) {
  const counts: Record<string, Record<string, number>> = { graphs: {}, kinds: {} }
  const both: string[] = []
  for (const [name, doc] of corpus) {
    const { result, both: twice } = outcome(doc, options)
    const group = counts[name.startsWith('kind ') ? 'kinds' : 'graphs']
    group[result] = (group[result] ?? 0) + 1
    if (twice) both.push(name)
  }
  return { counts, both }
}

describe('cpp over the gate corpus', () => {
  // frame steps are checked first, so the graphs that also sample a texture are reported for their frame steps
  it('rejects most graphs for frame steps in normal mode, ten of which also have GLSL-only bodies', () => {
    expect(tally({})).toEqual({
      counts: { graphs: { frame: 13, accepted: 2 }, kinds: { frame: 20, glsl: 8, accepted: 63 } },
      both: [
        'bar-sequencer.wledgraph', 'chroma-keys.wledgraph', 'high-contrast-music.wledgraph', 'kick-shockwave.wledgraph', 'liquid-nebula.wledgraph',
        'peak-meteor.wledgraph', 'spectral-aurora.wledgraph', 'bench/bench-audio-multi-fft.wledgraph', 'bench/bench-feedback.wledgraph', 'bench/bench-kitchen-sink.wledgraph',
      ],
    })
  })

  it('rejects standalone graphs only for GLSL-only bodies', () => {
    expect(tally({ standalone: true, controls: () => 0.5 })).toEqual({
      counts: { graphs: { glsl: 10, accepted: 5 }, kinds: { frame: 2, glsl: 8, accepted: 81 } },
      both: [],
    })
  })
})
