import { describe, expect, it } from 'vitest'
import { createDefaultGraph, newNodeData, type DataType, type GraphNodeData } from '@/lib/graph'
import { canConnect, styledEdges } from './links'

const nodes: Record<string, GraphNodeData> = {
  uv: newNodeData('uv'),
  time: newNodeData('time'),
  math: newNodeData('math'),
  env: newNodeData('envelopeFollower'),
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

  it('refuses a per-pixel value into a per-frame node, and takes a per-frame one', () => {
    expect(canConnect(link('uv', 'x', 'env', 'signal'), dataOf)).toBe(false)
    expect(canConnect(link('time', 'time', 'env', 'signal'), dataOf)).toBe(true)
  })
})

describe('styledEdges', () => {
  const colorOf = (type: DataType<any>) => `color-${type.id}`

  it('colors an unstyled link by its source socket and keeps a styled one', () => {
    const doc = createDefaultGraph()
    doc.edges[0] = { ...doc.edges[0], style: undefined }
    const styled = styledEdges(doc, colorOf)
    expect(styled[0].style).toEqual({ stroke: 'color-float', strokeWidth: 2 })
    expect(styled[1]).toBe(doc.edges[1])
  })

  it('leaves a link from an unknown socket unstyled', () => {
    const doc = createDefaultGraph()
    doc.edges[0] = { ...doc.edges[0], sourceHandle: 'nope', style: undefined }
    expect(styledEdges(doc, colorOf)[0].style).toBeUndefined()
  })
})
