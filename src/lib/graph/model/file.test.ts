import { describe, expect, it } from 'vitest'
import { normalizeDoc } from './doc'
import { GraphFileError, readGraphFile, serializeGraphFile } from './file'
import { graph, node } from '@/lib/graph/testing'

const doc = normalizeDoc(graph([node('uv', 'uv'), node('out', 'output')], [['uv.x', 'out.color']]))

describe('serializeGraphFile / readGraphFile', () => {
  it('round-trips a graph unchanged', () => {
    expect(readGraphFile(serializeGraphFile(doc)).doc).toEqual(doc)
  })

  it('keeps a muted, a renamed and a socket-hiding node through save and load', () => {
    const flagged = normalizeDoc(
      graph(
        [{ ...node('uv', 'uv'), data: { kind: 'uv', values: {}, muted: true, label: 'Coordinates', hideUnused: true } }, node('out', 'output')],
        [['uv.x', 'out.color']],
      ),
    )
    const { doc: loaded, problems } = readGraphFile(serializeGraphFile(flagged))
    expect(loaded).toEqual(flagged)
    expect(problems).toEqual([])
  })

  it('rejects malformed JSON', () => {
    expect(() => readGraphFile('not json')).toThrow(GraphFileError)
  })

  it('rejects a file from a different app', () => {
    expect(() => readGraphFile(JSON.stringify({ app: 'other', formatVersion: 1, graph: doc }))).toThrow(/not a wledtoy graph file/)
  })

  it('rejects an unsupported envelope format version', () => {
    expect(() => readGraphFile(JSON.stringify({ app: 'wledtoy', formatVersion: 99, graph: doc }))).toThrow(/format version 99/)
  })

  it('rejects a graph saved by an older graph version', () => {
    const old = JSON.stringify({ app: 'wledtoy', formatVersion: 1, graph: { ...doc, version: 2 } })
    expect(() => readGraphFile(old)).toThrow(/older version \(2\)/)
  })

  it('rejects a graph missing nodes or edges', () => {
    expect(() => readGraphFile(JSON.stringify({ app: 'wledtoy', formatVersion: 1, graph: { version: 3 } }))).toThrow(GraphFileError)
  })
})

describe('readGraphFile', () => {
  it('reports what a hand-written file gets wrong and the parser would otherwise swallow', () => {
    const raw = graph(
      [node('uv', 'uv'), node('time', 'time'), node('m', 'math', { op: 'add', nope: 1 }), node('out', 'output')],
      [
        ['uv.x', 'm.a'],
        ['time.time', 'm.a'],
        ['uv.what', 'm.b'],
        ['m.result', 'out.color'],
      ],
    )
    const { doc, problems } = readGraphFile(serializeGraphFile(raw))
    expect(doc.edges.map((e) => e.source)).toEqual(['time', 'uv', 'm'])
    expect(problems).toEqual([
      'm: "nope" is not an input of math with these values (inputs: op, clamp, a, b)',
      'edge time.time-m.a: "m.a" already has a link; only the last one is kept',
      'edge uv.what-m.b: "uv" has no output "what"',
    ])
  })

  it('reports mute, hidden sockets and a label of the wrong type', () => {
    const raw = graph([{ ...node('uv', 'uv'), data: { kind: 'uv', values: {}, muted: 'yes', hideUnused: 1, label: 7 } as never }])
    expect(readGraphFile(serializeGraphFile(raw)).problems).toEqual([
      'uv.hideUnused: 1 is not true or false',
      'uv.muted: "yes" is not true or false',
      'uv.label: 7 is not text',
    ])
  })

  it('finds nothing wrong with a graph the editor wrote', () => {
    expect(readGraphFile(serializeGraphFile(doc)).problems).toEqual([])
  })
})
