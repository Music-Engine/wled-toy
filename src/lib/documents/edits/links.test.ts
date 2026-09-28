import { describe, expect, it } from 'vitest'
import { createDefaultGraph, newNodeData, type DataType, type GraphNodeData } from '@/lib/graph'
import { canConnect, dissolveLinks, styleEdges } from './links'

const nodes: Record<string, GraphNodeData> = {
  uv: newNodeData('uv'),
  time: newNodeData('time'),
  math: newNodeData('math'),
  math2: newNodeData('math'),
  env: newNodeData('envelopeFollower'),
  fft: newNodeData('fft'),
  spectrum: newNodeData('spectrum'),
  split: newNodeData('bandSplit'),
}
const dataOf = (id: string) => nodes[id]
const link = (source: string, sourceHandle: string, target: string, targetHandle: string) => ({ source, sourceHandle, target, targetHandle })

describe('canConnect', () => {
  it('accepts an output into an input it casts to', () => {
    expect(canConnect(link('time', 'time', 'math', 'a'), dataOf)).toBe(true)
    expect(canConnect(link('uv', 'x', 'math', 'a'), dataOf)).toBe(true)
  })

  it('refuses a node linked to itself', () => {
    expect(canConnect(link('math', 'result', 'math', 'a'), dataOf)).toBe(false)
  })

  it('refuses a socket the node does not have', () => {
    expect(canConnect(link('time', 'nope', 'math', 'a'), dataOf)).toBe(false)
    expect(canConnect(link('time', 'time', 'math', 'nope'), dataOf)).toBe(false)
  })

  it('takes a per-pixel value into a stateful node, which then keeps its state per pixel', () => {
    expect(canConnect(link('uv', 'x', 'env', 'signal'), dataOf)).toBe(true)
  })
})

describe('dissolveLinks', () => {
  const dissolve = (edges: ReturnType<typeof link>[], ids: string[]) => dissolveLinks(edges, new Set(ids), dataOf)

  it('feeds each link out of a dissolved node from the first link into it that fits, in input order', () => {
    expect(dissolve([link('time', 'time', 'math', 'a'), link('uv', 'x', 'math', 'b'), link('math', 'result', 'env', 'signal')], ['math']))
      .toEqual([link('time', 'time', 'env', 'signal')])
    // a spectrum is no number, so the second input feeds it
    expect(dissolve([link('fft', 'spectrum', 'spectrum', 'spectrum'), link('time', 'time', 'spectrum', 'position'), link('spectrum', 'level', 'env', 'signal')], ['spectrum']))
      .toEqual([link('time', 'time', 'env', 'signal')])
  })

  it('follows a chain of dissolved nodes, and leaves an input unlinked when nothing fits', () => {
    expect(dissolve([link('time', 'time', 'math', 'b'), link('math', 'result', 'math2', 'a'), link('math2', 'result', 'env', 'signal')], ['math', 'math2']))
      .toEqual([link('time', 'time', 'env', 'signal')])
    expect(dissolve([link('fft', 'spectrum', 'split', 'spectrum'), link('split', 'level', 'env', 'signal')], ['split'])).toEqual([])
  })
})

describe('styleEdges', () => {
  const colorOf = (type: DataType<any>) => `color-${type.id}`

  it('colors an unstyled link by its source socket and keeps a styled one', () => {
    const doc = createDefaultGraph()
    doc.edges[0] = { ...doc.edges[0], style: undefined }
    const styled = styleEdges(doc, colorOf)
    expect(styled[0].style).toEqual({ stroke: 'color-float', strokeWidth: 2 })
    expect(styled[1]).toBe(doc.edges[1])
  })

  it('leaves a link from an unknown socket unstyled', () => {
    const doc = createDefaultGraph()
    doc.edges[0] = { ...doc.edges[0], sourceHandle: 'nope', style: undefined }
    expect(styleEdges(doc, colorOf)[0].style).toBeUndefined()
  })
})
