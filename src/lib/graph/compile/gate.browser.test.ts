import { describe, expect, it } from 'vitest'
import { allItems, canCast, generateGlsl, type GeneratedShader, type NodeItem } from '@/lib/graph'
import { Color } from '@/lib/graph/define/socket-types'
import type { CompileOptions } from './compile'
import type { NodeGraph } from '@/lib/graph/model/doc'
import { readGraphFile } from '@/lib/graph/model/file'
import { graph, node } from '@/lib/graph/testing'

const files = import.meta.glob('/graphs/**/*.wledgraph', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const graphs = Object.entries(files).map(([path, text]) => [path.split('/').pop()!.replace('.wledgraph', ''), text] as const)
const kinds = allItems()

const modes: Record<string, CompileOptions> = {
  normal: {},
  standalone: { standalone: true, controls: () => 0.5 },
}

function alone(item: NodeItem): NodeGraph {
  if (item.id === 'output') return graph([node('n', 'output')])
  const out = item.base.outputs[0]
  const drawable = out && canCast(out.type, Color)
  return graph([node('n', item.id), node('o', 'output')], drawable ? [[`n.${out.name}`, 'o.color']] : [])
}

function planJson({ control, issues, error, errorNode, frozen }: GeneratedShader): string {
  const steps = control.steps.map(({ nodeId, kind, inputs, dims, run, state }) => ({ nodeId, kind, inputs, dims, run: !!run, state: !!state }))
  const plan = { steps, exports: control.exports, resources: control.resources, issues, error, errorNode, frozen }
  // a `frame` input binding is a function too; like `run`, only its presence is recorded
  return `${JSON.stringify(plan, (_, value) => (typeof value === 'function' ? true : value), 2)}\n`
}

const written = new Set<string>()

async function snapshot(name: string, doc: NodeGraph) {
  for (const [mode, options] of Object.entries(modes)) {
    const shader = generateGlsl(doc, options)
    const base = `./__snapshots__/gate/${name}.${mode}`
    await expect(shader.code).toMatchFileSnapshot(`${base}.glsl`)
    await expect(planJson(shader)).toMatchFileSnapshot(`${base}.plan.json`)
    written.add(`${base}.glsl`).add(`${base}.plan.json`)
  }
}

describe('compile gate', () => {
  it.each(graphs)('graph %s', (name, text) => snapshot(name, readGraphFile(text).doc))

  it.each(kinds.map((item) => [item.id, item] as const))('kind %s alone', (id, item) => snapshot(id, alone(item)))

  it('wrote a glsl and a plan file per mode for every graph and kind', () => {
    expect(written.size).toBe(2 * Object.keys(modes).length * (graphs.length + kinds.length))
  })
})
