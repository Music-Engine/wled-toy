import { describe, expect, it } from 'vitest'
import { GRAPH_VERSION, canCast, generateGlsl, inputSocket, normalizeDoc, type NodeGraph } from '@/lib/graph'
import { Color, Float, GenType, Int, Sampler2D, Vec2, Vec4 } from '@/lib/graph/define/socket-types'
import { flattenFs } from '@/lib/shader/menu-fs'
import { GLSL_TYPES } from '@/lib/shader/glsl'
import { GRAPH_FS } from '@/lib/graph/menu/fs'
import { graph, node } from '@/lib/graph/testing'

describe('canCast', () => {
  it('links any numeric type to any other, in both directions through genType', () => {
    expect([canCast(Float, Color), canCast(Vec4, GenType), canCast(GenType, Vec2), canCast(Int, Float)]).toEqual([true, true, true, true])
  })

  it('keeps samplers to themselves', () => {
    expect([canCast(Sampler2D, Float), canCast(Float, Sampler2D), canCast(Sampler2D, Sampler2D)]).toEqual([false, false, true])
  })
})

describe('sockets', () => {
  it('stored inputs take no links', () => {
    const math = { kind: 'math', values: {} }
    expect(inputSocket(math, 'op')).toBeUndefined()
    expect(inputSocket(math, 'a')?.type).toBe(GenType)
  })
})

describe('normalizeDoc', () => {
  it('keeps the newest link per input and stamps the version', () => {
    const doc = normalizeDoc(graph([node('m', 'math', { b: 2 })], [['x.out', 'm.a'], ['y.out', 'm.a']]))
    expect(doc.edges.map((e) => e.source)).toEqual(['y'])
    expect(doc.version).toBe(GRAPH_VERSION)
  })
})

describe('socket names', () => {
  it('every socket says what it carries, never a GLSL type or a bare lowercase letter', () => {
    const vague = flattenFs(GRAPH_FS.items).flatMap(({ node: item }) =>
      [...item.base.inputs.filter((s) => s.connectable), ...item.base.outputs]
        .filter((s) => [...GLSL_TYPES, 'genType', 'out', 'result'].includes(s.label) || /^[a-z]?$/.test(s.label))
        .map((s) => `${item.id}.${s.name}`))
    expect(vague).toEqual([])
  })
})

describe('generateGlsl', () => {
  const toOutput = (doc: NodeGraph) => generateGlsl(doc)

  it('widens generic sockets to the widest linked type', () => {
    const { code } = toOutput(graph([node('c', 'color'), node('m', 'math', { op: 'add', b: 0.5 }), node('o', 'output')], [['c.color', 'm.a'], ['m.result', 'o.color']]))
    expect(code).toContain('vec3 n_m = vec3(1.0, 0.45, 0.1) + vec3(0.5);')
  })

  it('clamps math when asked', () => {
    const { code } = toOutput(graph([node('m', 'math', { op: 'add', clamp: true }), node('o', 'output')], [['m.result', 'o.color']]))
    expect(code).toContain('float n_m = clamp(0.5 + 0.5, 0.0, 1.0);')
  })

  it('falls back to defaults on invalid stored values and says so', () => {
    const result = toOutput(graph([node('m', 'math', { op: 'nope', a: 'x' }), node('o', 'output')], [['m.result', 'o.color']]))
    expect(result.error).toBeNull()
    expect(result.issues.map((i) => i.nodeId)).toEqual(['m', 'm'])
    expect(result.code).toContain('float n_m = 0.5 + 0.5;')
  })

  it('reports an uncastable link on the node that receives it', () => {
    const result = toOutput(graph([node('i', 'iImage'), node('o', 'output')], [['i.out', 'o.color']]))
    expect(result.errorNode).toBe('o')
    expect(result.error).toMatch(/Cannot cast sampler2D/)
  })

  it('reports loops and a missing output', () => {
    const loop = toOutput(graph([node('a', 'math'), node('b', 'math'), node('o', 'output')], [['a.result', 'b.a'], ['b.result', 'a.a'], ['a.result', 'o.color']]))
    expect(loop.error).toMatch(/loop/)
    expect(toOutput(graph([])).error).toMatch(/Output node/)
  })

  it('maps every emitted line to the node that produced it', () => {
    const { code, lineNodes } = toOutput(graph([node('m', 'math'), node('o', 'output')], [['m.result', 'o.color']]))
    const lines = code.split('\n')
    expect(lineNodes[lines.findIndex((l) => l.includes('n_m =')) + 1]).toBe('m')
    expect(lineNodes[lines.findIndex((l) => l.includes('c = vec4(vec3')) + 1]).toBe('o')
  })
})

describe('streams', () => {
  it('a stream linked into a number socket is a graph error on the receiving node', () => {
    const result = generateGlsl(graph([node('f', 'fft'), node('o', 'output')], [['f.spectrum', 'o.color']]))
    expect(result).toMatchObject({ errorNode: 'o', error: 'Color needs a number or a color, not Spectrum' })
  })
})
