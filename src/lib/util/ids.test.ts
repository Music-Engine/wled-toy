import { describe, expect, it } from 'vitest'
import { newId } from './ids'

describe('newId', () => {
  // 10 base36 characters carry about 51 bits: a graph or device list would need tens of millions of ids
  // before a collision became likely, while the id stays short enough to read in a saved file and in GLSL names
  it('is ten lowercase base36 characters, a plain string any graph file version accepts', () => {
    expect(newId()).toMatch(/^[0-9a-z]{10}$/)
  })

  it('does not repeat across many calls in the same millisecond', () => {
    const ids = Array.from({ length: 10000 }, newId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
