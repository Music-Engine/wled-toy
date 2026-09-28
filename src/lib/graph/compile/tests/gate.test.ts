import { describe, expect, it } from 'vitest'
import type { NodeGraph } from '@/lib/graph/model/doc'
import { createGlslCompiler, createUsermodCompiler } from '@/lib/graph/compile/compilers'
import { listCorpusGraphs, listCorpusKinds } from '@/lib/graph/compile/corpus'
import type { NodeShape } from '@/lib/graph/define/shape'
import { readStoredShape } from '@/lib/graph/registry'

const graphs = listCorpusGraphs()
const kinds = listCorpusKinds()
const LEDS = 30

const isFrameBound = (shape: NodeShape | undefined) => Boolean(shape?.state || shape?.probe || shape?.prefers)

const written = new Set<string>()

async function writeSnapshot(name: string, doc: NodeGraph) {
  const shader = createGlslCompiler().compile(doc)
  const unit = createUsermodCompiler(LEDS).compile(doc)
  const standalone = createGlslCompiler({ standalone: true }).compile(doc)
  const base = `../__snapshots__/gate/${name}`
  const { pixel = '', frame = null, lineNodes, ...rest } = shader.program ?? {}
  // `line: node`, target lines left out
  const lines = lineNodes && Object.fromEntries(Object.entries(lineNodes).map(([pass, nodes]) => [pass, Object.fromEntries(nodes.flatMap((node, line) => (node ? [[line, node]] : [])))]))
  const summary = { glsl: { ...rest, lineNodes: lines, frame: frame && { texels: frame.texels, probes: frame.probes }, issues: shader.issues, slots: shader.slots }, usermod: { issues: unit.issues }, standalone: { issues: standalone.issues } }
  await expect(pixel).toMatchFileSnapshot(`${base}.pixel.glsl`)
  await expect(frame?.code ?? '').toMatchFileSnapshot(`${base}.frame.glsl`)
  await expect(unit.program?.code ?? '').toMatchFileSnapshot(`${base}.cpp`)
  await expect(standalone.program?.pixel ?? '').toMatchFileSnapshot(`${base}.standalone.glsl`)
  await expect(`${JSON.stringify(summary, null, 2)}\n`).toMatchFileSnapshot(`${base}.json`)
  written.add(name)
}

describe('compile gate', () => {
  it.each(graphs)('graph %s', (name, doc) => writeSnapshot(name, doc))

  it.each(kinds)('kind %s alone', (id, doc) => writeSnapshot(id, doc))

  it('runs a graph w/o state, probe or frame hint in the pixel pass alone, and exports that pass as is w/o uniforms', () => {
    const plain = [...graphs, ...kinds].filter(([, doc]) => doc.nodes.every(({ data }) => !isFrameBound(readStoredShape(data))))
    expect(plain.length).toBeGreaterThan(0)
    for (const [, doc] of plain) {
      const { program, slots } = createGlslCompiler().compile(doc)
      expect(program!.frame).toBeNull()
      expect(slots.global).toEqual({})
      expect(program!.pixel).not.toContain('iGlobal')
      if (program!.uniforms.length === 0) expect(createGlslCompiler({ standalone: true }).compile(doc).program!.pixel).toBe(program!.pixel)
    }
  })

  it('wrote every graph and every kind', () => {
    expect(written.size).toBe(graphs.length + kinds.length)
  })
})
