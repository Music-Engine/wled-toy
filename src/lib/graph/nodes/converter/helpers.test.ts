import { describe, expect, it } from 'vitest'
import { createGlslCompiler, type NodeGraph } from '@/lib/graph'
import { graph, node } from '@/lib/graph/testing'

/** Both passes' shader text */
function compileText(doc: NodeGraph): string {
  const { program } = createGlslCompiler().compile(doc)
  return `${program!.pixel}${program!.frame?.code ?? ''}`
}

const compileMath = (values: object, extra: ReturnType<typeof node>[] = [], links: [string, string][] = []) =>
  compileText(graph([node('m', 'math', values as never), ...extra, node('o', 'output')], [...links, ['m.result', 'o.color']]))

describe('math helpers in the generated shader', () => {
  it('Add pulls in no helper at all', () => {
    expect(compileMath({ op: 'add' })).not.toContain('node_')
  })

  it('Power pulls in node_pow for the width it runs at, and nothing else', () => {
    const scalar = compileMath({ op: 'power' })
    expect(scalar).toContain('float node_pow(float a, float b)')
    expect(scalar).not.toContain('vec3 node_pow')
    expect(scalar).not.toContain('node_divide')
    const vector = compileMath({ op: 'power' }, [node('c', 'color')], [['c.color', 'm.a']])
    expect(vector).toContain('vec3 node_pow(vec3 a, vec3 b)')
    expect(vector).not.toContain('float node_pow')
  })

  it('a helper brings what it depends on, once', () => {
    const snap = compileMath({ op: 'snap' })
    expect(snap.match(/float node_zero\(/g)).toHaveLength(1)
    expect(snap.match(/float node_divide\(/g)).toHaveLength(1)
    expect(snap.indexOf('node_zero(float')).toBeLessThan(snap.indexOf('float node_divide('))
    expect(snap.indexOf('float node_divide(')).toBeLessThan(snap.indexOf('float node_snap('))
  })

  it('Vector Math Divide includes the vec3 helper only', () => {
    const text = compileText(graph([node('v', 'vectorMath', { op: 'divide' }), node('o', 'output')], [['v.vector', 'o.color']]))
    expect(text).toContain('vec3 node_divide(')
    expect(text).not.toContain('float node_divide(')
  })
})
