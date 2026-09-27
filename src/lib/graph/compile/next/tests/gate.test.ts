import { describe, expect, it } from 'vitest'
import type { NodeGraph } from '@/lib/graph/model/doc'
import { createGlslCompiler, createUsermodCompiler } from '@/lib/graph/compile/next/compilers'
import { corpusGraphs, corpusKinds } from '@/lib/graph/compile/next/corpus'

const graphs = corpusGraphs()
const kinds = corpusKinds()
const LEDS = 30

const written = new Set<string>()

async function snapshot(name: string, doc: NodeGraph) {
  const shader = createGlslCompiler().compile(doc)
  const unit = createUsermodCompiler(LEDS).compile(doc)
  const base = `../../__snapshots__/gate-next/${name}`
  const { pixel = '', frame = null, lineNodes, ...rest } = shader.program ?? {}
  // the lines a node emitted, as `line: node`, leaving out the target's own
  const lines = lineNodes && Object.fromEntries(Object.entries(lineNodes).map(([pass, nodes]) => [pass, Object.fromEntries(nodes.flatMap((node, line) => (node ? [[line, node]] : [])))]))
  const summary = { glsl: { ...rest, lineNodes: lines, frame: frame && { texels: frame.texels, probes: frame.probes }, issues: shader.issues, slots: shader.slots }, usermod: { issues: unit.issues } }
  await expect(pixel).toMatchFileSnapshot(`${base}.pixel.glsl`)
  await expect(frame?.code ?? '').toMatchFileSnapshot(`${base}.frame.glsl`)
  await expect(unit.program?.code ?? '').toMatchFileSnapshot(`${base}.cpp`)
  await expect(`${JSON.stringify(summary, null, 2)}\n`).toMatchFileSnapshot(`${base}.json`)
  written.add(name)
}

describe('compile gate, next', () => {
  it.each(graphs)('graph %s', (name, doc) => snapshot(name, doc))

  it.each(kinds)('kind %s alone', (id, doc) => snapshot(id, doc))

  it('wrote every graph and every kind', () => {
    expect(written.size).toBe(graphs.length + kinds.length)
  })

  // knob, MIDI and OSC keep only their frame body for the old pipeline and reach the new one as uniforms from resources
  it('has a body or only resources for every kind', () => {
    const javascriptOnly = kinds.filter(([, doc]) => createGlslCompiler().compile(doc).issues.some((issue) => issue.message.includes('runs only in JavaScript')))
    expect(javascriptOnly.map(([id]) => id)).toEqual([])
  })
})
