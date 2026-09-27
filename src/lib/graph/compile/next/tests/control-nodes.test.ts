import { describe, expect, it } from 'vitest'
import { graph, node } from '@/lib/graph/testing'
import { cppCompiler, runUsermod } from '@/lib/graph/testing/cpp'
import { glslCompiler, usermodCompiler } from '@/lib/graph/compile/next/compilers'

/** Knobs `k0`, `k1`, ... at 0.25 and the other `sources`, each output summed into the Output's color. */
function summed(knobs: number, sources: { id: string; kind: string }[] = []) {
  const outputs = [...Array.from({ length: knobs }, (_, i) => `k${i}.value`), ...sources.map(({ id }) => `${id}.value`)]
  const adds = outputs.slice(1).map((_, i) => node(`add${i}`, 'math', { op: 'add' }))
  const links = outputs.slice(1).flatMap((output, i): [string, string][] => [[i === 0 ? outputs[0] : `add${i - 1}.result`, `add${i}.a`], [output, `add${i}.b`]])
  const nodes = [...Array.from({ length: knobs }, (_, i) => node(`k${i}`, 'knob', { value: 0.25 })), ...sources.map(({ id, kind }) => node(id, kind)), ...adds, node('o', 'output')]
  return graph(nodes, [...links, [adds.length ? `add${adds.length - 1}.result` : outputs[0], 'o.color']])
}

describe('knob, MIDI In and OSC In read uniforms the host writes', () => {
  it('lists a knob with its offset and what the Parameters panel shows, and the pixel pass reads it', () => {
    const doc = graph([node('k', 'knob', { label: 'Hue', value: 2, min: 0, max: 1, cc: 7 }), node('o', 'output')], [['k.value', 'o.color']])
    const { program, slots } = glslCompiler().compile(doc)
    expect(program!.uniforms).toEqual([{ node: 'k', output: 'value', offset: 0, kind: 'knob', default: 1, label: 'Hue', min: 0, max: 1, cc: 7 }])
    expect(program!.pixel).toContain('c = vec4(vec3(iControl[0].x), 1.0);')
    expect(program!.frame).toBeNull()
    expect(slots.global).toEqual({})
  })

  it('numbers every output of OSC In and MIDI In in topo order, and a frame node reads them in the frame pass', () => {
    const doc = graph(
      [node('k', 'knob'), node('s', 'oscIn', { address: '/x' }), node('m', 'midiIn', { kind: 'note', number: 60 }), node('a', 'math', { op: 'add' }), node('b', 'math', { op: 'add' }), node('o', 'output')],
      [['k.value', 'a.a'], ['s.third', 'a.b'], ['a.result', 'b.a'], ['m.gate', 'b.b'], ['b.result', 'o.color']],
    )
    const { program } = glslCompiler().compile(doc)
    expect(program!.uniforms.map(({ node: id, output, offset }) => `${id}.${output}@${offset}`)).toEqual(['k.value@0', 's.value@1', 's.second@2', 's.third@3', 'm.value@4', 'm.gate@5'])
    expect(program!.uniforms.slice(1)).toMatchObject([
      { kind: 'osc', address: '/x', argument: 0 }, { kind: 'osc', argument: 1 }, { kind: 'osc', argument: 2 },
      { kind: 'midi', message: 'note', channel: 0, number: 60, gate: false }, { kind: 'midi', gate: true },
    ])
    expect(program!.frame!.code).toContain('iControl[0].x + iControl[0].w')
    expect(program!.frame!.code).toContain('iControl[1].y')
  })
})

describe('viewer and scene switch are probes', () => {
  it('reads a viewer back from one global state slot', () => {
    const doc = graph([node('t', 'time'), node('v', 'viewer'), node('o', 'output')], [['t.time', 'v.value']])
    const { program, slots } = glslCompiler().compile(doc)
    expect(program!.probes).toEqual({ v: 0 })
    expect(program!.frame!.probes).toEqual([0])
    expect(slots.global).toEqual({ 'v:value': { value: { type: 'float', offset: 0 } } })
    expect(program!.frame!.code).toContain('globalState[0].x = iTime;')
  })

  it('puts the scene index out rounded and never below 0', () => {
    const { program } = glslCompiler().compile(graph([node('s', 'sceneSwitch', { index: 1.6 }), node('o', 'output')]))
    expect(program!.probes).toEqual({ s: 0 })
    expect(program!.frame!.code).toContain('max(0.0, floor(1.6 + 0.5))')
  })
})

describe('the usermod compiler', () => {
  it('reports the viewer, the OSC node, the MIDI node and a knob past the sliders, each by name, and returns no program', () => {
    const doc = summed(3, [{ id: 's', kind: 'oscIn' }, { id: 'm', kind: 'midiIn' }])
    doc.nodes.push(node('v', 'viewer'))
    const { program, issues } = usermodCompiler(8, { sliders: 2 }).compile(doc)
    expect(program).toBeNull()
    expect(issues).toEqual(expect.arrayContaining([
      { nodeId: 'v', message: 'Viewer is read back by the host, which a usermod does not do' },
      { nodeId: 's', message: 'OSC In reads OSC, which a usermod has no input for' },
      { nodeId: 'm', message: 'MIDI In reads MIDI, which a usermod has no input for' },
      { nodeId: 'k2', message: 'Knob has no slider left; the effect has 2' },
    ]))
    expect(issues).toHaveLength(4)
  })

  it('takes five knobs by default', () => {
    expect(usermodCompiler(8).compile(summed(6)).issues).toEqual([{ nodeId: 'k5', message: 'Knob has no slider left; the effect has 5' }])
  })

  it.skipIf(!cppCompiler)('shades with a knob at its default until the host writes one (needs g++ or c++ on PATH)', () => {
    const { program } = usermodCompiler(1).compile(summed(1))
    expect(program!.code).toContain('vec4 iControl[1] = { vec4(0.25, 0, 0, 0) };')
    expect(runUsermod(program!.code, { leds: 1, frames: 1 })).toEqual([[[64, 64, 64]]])
  })
})
