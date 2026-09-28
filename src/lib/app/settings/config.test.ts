import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
vi.stubGlobal('window', { addEventListener: () => undefined })
const { sanitize } = await import('./config')

describe('sanitize', () => {
  it('keeps a well-formed graph of any version for the graph session to judge, and drops one without nodes or edges', () => {
    const old = { version: 3, nodes: [], edges: [] }
    expect(sanitize({ graph: old }).graph).toEqual(old)
    expect(sanitize({ graph: { version: 3, nodes: [] } }).graph).toBeUndefined()
  })
})
