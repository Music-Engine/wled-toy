import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
vi.stubGlobal('window', { addEventListener: () => undefined })
const { sanitize } = await import('./config')
const { GRAPH_VERSION } = await import('@/lib/graph/model/doc')

describe('sanitize', () => {
  it('keeps a graph of the current version and drops an older one', () => {
    const current = { version: GRAPH_VERSION, nodes: [], edges: [] }
    expect(sanitize({ graph: current }).graph).toEqual(current)
    expect(sanitize({ graph: { version: 2, nodes: [], edges: [] } }).graph).toBeNull()
    expect(sanitize({ graph: { nodes: [], edges: [] } }).graph).toBeNull()
  })
})
