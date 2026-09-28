import { describe, expect, it } from 'vitest'
import type { NodeItem } from '@/lib/graph/define/shape'
import type { NodeGraph } from '@/lib/graph/model/doc'
import { allItems, nodeItem, valueInputs } from '@/lib/graph/registry'
import { alone, graph, node } from '@/lib/graph/testing'
import { buildProgram, generateGlsl } from '@/lib/graph/compile/compile'
import { cpp } from '@/lib/graph/compile/cpp/cpp'
import { glslCompiler, usermodCompiler } from '@/lib/graph/compile/next/compilers'
import { corpusGraphs } from '@/lib/graph/compile/next/corpus'

const graphs = corpusGraphs()
const TWINS = ['mix', 'math', 'clamp', 'vectorMath', 'combineXYZ', 'separateXYZ', 'fromCenter', 'random', 'remap', 'curve', 'wave', 'time']
const LEDS = 30

/** Both pipelines run the whole graph per pixel: the old one has no frame step, the new one no frame pass. */
function pixelOnly(doc: NodeGraph): boolean {
  const old = generateGlsl(doc)
  const next = glslCompiler().compile(doc).program
  return old.error === null && old.frame.steps.length === 0 && next !== null && next.frame === null
}

/** The kind fed from `uv.x` on its first number input, so it runs per pixel in both pipelines. */
function fedPerPixel(item: NodeItem): NodeGraph {
  const doc = alone(item)
  const [input] = valueInputs(item.base)
  return { ...doc, nodes: [...doc.nodes, node('uv', 'uv')], edges: [...doc.edges, ...graph([], [['uv.x', `n.${input.name}`]]).edges] }
}

const oldUnit = (doc: NodeGraph) => {
  try {
    return cpp(buildProgram(doc, {}), { leds: LEDS })
  } catch {
    return null
  }
}

function expectSameCode(doc: NodeGraph) {
  expect(glslCompiler().compile(doc).program!.pixel).toBe(generateGlsl(doc).code)
  const unit = oldUnit(doc)
  if (unit) expect(usermodCompiler(LEDS).compile(doc).program!.code).toBe(unit)
}

describe('a pixel-only graph compiles to the old pipeline\'s code, byte for byte', () => {
  const pixelGraphs = graphs.filter(([, doc]) => pixelOnly(doc))
  const twinsAlone = TWINS.filter((kind) => pixelOnly(alone(nodeItem(kind)!)))
  const twinsFed = TWINS.filter((kind) => !twinsAlone.includes(kind) && valueInputs(nodeItem(kind)!.base).length > 0)

  it('covers the pixel-only graphs and every twin, alone or fed from uv.x; Time has no input to feed', () => {
    expect(pixelGraphs.map(([name]) => name).sort()).toEqual(['bench-baseline', 'bench-wide'])
    expect(twinsAlone).toEqual(['mix', 'clamp', 'separateXYZ', 'fromCenter', 'random', 'remap', 'curve'])
    expect(twinsFed).toEqual(['math', 'vectorMath', 'combineXYZ', 'wave'])
    expect(twinsFed.map((kind) => pixelOnly(fedPerPixel(nodeItem(kind)!)))).toEqual(twinsFed.map(() => true))
  })

  it.each(pixelGraphs)('graph %s', (_, doc) => expectSameCode(doc))

  it.each(twinsAlone)('twin %s alone', (kind) => expectSameCode(alone(nodeItem(kind)!)))

  it.each(twinsFed)('twin %s fed from uv.x', (kind) => expectSameCode(fedPerPixel(nodeItem(kind)!)))

  it('holds for every other kind alone that runs per pixel in both', () => {
    const kinds = allItems().filter((item) => !TWINS.includes(item.id) && pixelOnly(alone(item)))
    expect(kinds).toHaveLength(43)
    for (const item of kinds) expectSameCode(alone(item))
  })
})
