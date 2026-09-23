import { describe, expect, it } from 'vitest'
import { generateGlsl } from '@/lib/graph'
import { graph, node } from '@/lib/graph/testing'

const code = (values: object, extra: ReturnType<typeof node>[] = [], links: [string, string][] = []) =>
  generateGlsl(graph([node('m', 'math', values as never), ...extra, node('o', 'output')], [...links, ['m.result', 'o.color']])).code

describe('math helpers in the generated shader', () => {
  it('Add pulls in no helper at all', () => {
    expect(code({ op: 'add' })).not.toContain('node_')
  })

  it('Power pulls in node_pow for the width it runs at, and nothing else', () => {
    const scalar = code({ op: 'power' })
    expect(scalar).toContain('float node_pow(float a, float b)')
    expect(scalar).not.toContain('vec3 node_pow')
    expect(scalar).not.toContain('node_divide')
    const vector = code({ op: 'power' }, [node('c', 'color')], [['c.color', 'm.a']])
    expect(vector).toContain('vec3 node_pow(vec3 a, vec3 b)')
    expect(vector).not.toContain('float node_pow')
  })

  it('a helper brings what it depends on, once', () => {
    const snap = code({ op: 'snap' })
    expect(snap.match(/float node_zero\(/g)).toHaveLength(1)
    expect(snap.match(/float node_divide\(/g)).toHaveLength(1)
    expect(snap.indexOf('node_zero(float')).toBeLessThan(snap.indexOf('float node_divide('))
    expect(snap.indexOf('float node_divide(')).toBeLessThan(snap.indexOf('float node_snap('))
  })

  it('Vector Math Divide includes the vec3 helper only', () => {
    const { code } = generateGlsl(graph([node('v', 'vectorMath', { op: 'divide' }), node('o', 'output')], [['v.vector', 'o.color']]))
    expect(code).toContain('vec3 node_divide(')
    expect(code).not.toContain('float node_divide(')
  })
})
