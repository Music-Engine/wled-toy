import { describe, expect, it } from 'vitest'
import { GRAPH_VERSION, canCast, findInputSocket, findNodeItem, normalizeDoc, type NodeGraph } from '@/lib/graph'
import { Color, Float, GenType, Int, Sampler2D, Vec2, Vec4 } from '@/lib/graph/define/socket-types'
import { flattenFs } from '@/lib/shader/menu-fs'
import { GLSL_TYPES } from '@/lib/shader/catalog'
import { GRAPH_FS } from '@/lib/graph/menu/fs'
import { graph, node } from '@/lib/graph/testing'
import { createGlslCompiler } from '@/lib/graph/compile/compilers'

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
    expect(findInputSocket(math, 'op')).toBeUndefined()
    expect(findInputSocket(math, 'a')?.type).toBe(GenType)
  })
})

describe('normalizeDoc', () => {
  it('keeps the newest link per input and stamps the version', () => {
    const doc = normalizeDoc(
      graph(
        [node('m', 'math', { b: 2 })],
        [
          ['x.out', 'm.a'],
          ['y.out', 'm.a'],
        ],
      ),
    )
    expect(doc.edges.map((e) => e.source)).toEqual(['y'])
    expect(doc.version).toBe(GRAPH_VERSION)
  })
})

describe('socket names', () => {
  it('every socket says what it carries, never a GLSL type or a bare lowercase letter', () => {
    const vague = flattenFs(GRAPH_FS.items).flatMap(({ node: item }) =>
      [...item.base.inputs.filter((s) => s.linkable), ...item.base.outputs]
        .filter((s) => [...GLSL_TYPES, 'genType', 'out', 'result'].includes(s.label) || /^[a-z]?$/.test(s.label))
        .map((s) => `${item.id}.${s.name}`),
    )
    expect(vague).toEqual([])
  })
})

/** Frame pass then pixel pass */
const readCode = (doc: NodeGraph) => {
  const { program } = createGlslCompiler().compile(doc)
  return `${program?.frame?.code ?? ''}${program?.pixel ?? ''}`
}
/** Issue that withheld the program */
const readFailure = (doc: NodeGraph) => {
  const { program, issues } = createGlslCompiler().compile(doc)
  expect(program).toBeNull()
  return issues.at(-1)
}

describe('createGlslCompiler', () => {
  it('widens generic sockets to the widest linked type', () => {
    const doc = graph(
      [node('u', 'uv'), node('c', 'combineColor'), node('m', 'math', { op: 'add', b: 0.5 }), node('o', 'output')],
      [
        ['u.x', 'c.a'],
        ['c.color', 'm.a'],
        ['m.result', 'o.color'],
      ],
    )
    expect(readCode(doc)).toMatch(/vec3 n_m = n_c \+ vec3\(0\.5\);/)
  })

  it('clamps math when asked', () => {
    expect(readCode(graph([node('m', 'math', { op: 'add', clamp: true }), node('o', 'output')], [['m.result', 'o.color']]))).toContain(
      'float n_m = clamp(0.5 + 0.5, 0.0, 1.0);',
    )
  })

  it('an invalid stored value is an error on its node that names the socket and the value', () => {
    const drawn = (values: object) => readFailure(graph([node('m', 'math', values as never), node('o', 'output')], [['m.result', 'o.color']]))
    expect(drawn({ a: 'x' })).toEqual({ nodeId: 'm', message: 'Value is "x", not a valid Number or vector' })
    expect(drawn({ op: 'nope' })).toEqual({ nodeId: 'm', message: 'op is "nope", not a valid Option' })
  })

  it('reports an uncastable link on the node that receives it', () => {
    const failure = readFailure(
      graph(
        [node('c', 'color'), node('t', 'texture'), node('o', 'output')],
        [
          ['c.color', 't.texture'],
          ['t.out', 'o.color'],
        ],
      ),
    )
    expect(failure?.nodeId).toBe('t')
    expect(failure?.message).toMatch(/Cannot cast vec3 to sampler2D/)
  })

  it('reports loops and a missing output', () => {
    expect(
      readFailure(
        graph(
          [node('a', 'math'), node('b', 'math'), node('o', 'output')],
          [
            ['a.result', 'b.a'],
            ['b.result', 'a.a'],
            ['a.result', 'o.color'],
          ],
        ),
      )?.message,
    ).toMatch(/loop/)
    expect(readFailure(graph([]))?.message).toMatch(/Output node/)
  })

  it('maps every emitted line to the node that produced it', () => {
    const { pixel, lineNodes } = createGlslCompiler().compile(
      graph(
        [node('u', 'uv'), node('m', 'math'), node('o', 'output')],
        [
          ['u.x', 'm.a'],
          ['m.result', 'o.color'],
        ],
      ),
    ).program!
    const lines = pixel.split('\n')
    expect(lineNodes.pixel[lines.findIndex((l) => l.includes('n_m =')) + 1]).toBe('m')
    expect(lineNodes.pixel[lines.findIndex((l) => l.includes('c = vec4(vec3')) + 1]).toBe('o')
  })
})

describe('mute', () => {
  const muteNode = (id: string, kind: string) => ({ ...node(id, kind), data: { kind, values: {}, muted: true } })

  it('a muted node between a source and a sink hands the sink the source, through a chain of muted nodes too', () => {
    const direct = readCode(graph([node('v', 'value'), node('o', 'output')], [['v.value', 'o.color']]))
    expect(
      readCode(
        graph(
          [node('v', 'value'), muteNode('m', 'math'), node('o', 'output')],
          [
            ['v.value', 'm.a'],
            ['m.result', 'o.color'],
          ],
        ),
      ),
    ).toBe(direct)
    expect(
      readCode(
        graph(
          [node('v', 'value'), muteNode('m', 'math'), muteNode('n', 'math'), node('o', 'output')],
          [
            ['v.value', 'm.b'],
            ['m.result', 'n.a'],
            ['n.result', 'o.color'],
          ],
        ),
      ),
    ).toBe(direct)
  })

  it('a muted node with no input to pass leaves the sink on its fallback', () => {
    const unlinked = readCode(graph([node('o', 'output')]))
    expect(readCode(graph([muteNode('m', 'math'), node('o', 'output')], [['m.result', 'o.color']]))).toBe(unlinked)
  })

  it('a muted sink still draws', () => {
    const drawn = readCode(graph([node('v', 'value'), node('o', 'output')], [['v.value', 'o.color']]))
    expect(readCode(graph([node('v', 'value'), muteNode('o', 'output')], [['v.value', 'o.color']]))).toBe(drawn)
  })

  it('a loop of muted nodes is still a loop', () => {
    const doc = graph(
      [muteNode('a', 'math'), muteNode('b', 'math'), node('o', 'output')],
      [
        ['a.result', 'b.a'],
        ['b.result', 'a.a'],
        ['a.result', 'o.color'],
      ],
    )
    expect(readFailure(doc)?.message).toMatch(/loop/)
  })
})

describe('streams', () => {
  it('a stream linked into a number socket is a graph error on the receiving node', () => {
    expect(readFailure(graph([node('f', 'fft'), node('o', 'output')], [['f.spectrum', 'o.color']]))).toEqual({
      nodeId: 'o',
      message: 'Color needs a number or a color, not Spectrum',
    })
    expect(
      readFailure(
        graph(
          [node('f', 'fft'), node('i', 'integrator'), node('o', 'output')],
          [
            ['f.spectrum', 'i.rate'],
            ['i.value', 'o.color'],
          ],
        ),
      ),
    ).toEqual({ nodeId: 'i', message: 'Rate needs a number or a color, not Spectrum' })
  })

  it('a link to an output the source lacks reads as unlinked', () => {
    const unlinked = readCode(graph([node('f', 'fft'), node('o', 'output')]))
    expect(readCode(graph([node('f', 'fft'), node('o', 'output')], [['f.level', 'o.color']]))).toBe(unlinked)
  })
})

describe('resolve', () => {
  it('hands its data to the bodies as resolved, never over an input of the same name', () => {
    const spectrum = findNodeItem('spectrum')!.base
    spectrum.resolve = () => ({ data: { spectrum: { slot: 3 } } })
    try {
      const doc = graph(
        [node('f', 'fft', { fmin: 100 }), node('s', 'spectrum'), node('o', 'output')],
        [
          ['f.spectrum', 's.spectrum'],
          ['s.level', 'o.color'],
        ],
      )
      expect(readCode(doc)).toContain('historyAt(1, ')
    } finally {
      delete spectrum.resolve
    }
  })
})
