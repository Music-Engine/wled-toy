import { describe, expect, it } from 'vitest'
import type { NodeGraph } from '@/lib/graph/model/doc'
import { glslCompiler, usermodCompiler } from '@/lib/graph/compile/next/compilers'
import { corpusGraphs, corpusKinds } from '@/lib/graph/compile/next/corpus'

const graphs = corpusGraphs()
const kinds = corpusKinds()
const LEDS = 30

const written = new Set<string>()

async function snapshot(name: string, doc: NodeGraph) {
  const shader = glslCompiler().compile(doc)
  const unit = usermodCompiler(LEDS).compile(doc)
  const base = `../../__snapshots__/gate-next/${name}`
  const { pixel = '', frame = null, ...rest } = shader.program ?? {}
  const summary = { glsl: { ...rest, frame: frame && { texels: frame.texels, probes: frame.probes }, issues: shader.issues, slots: shader.slots }, usermod: { issues: unit.issues } }
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
})
