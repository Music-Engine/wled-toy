import { describe, expect, it } from 'vitest'
import { GRAPH_VERSION } from '@/lib/graph/model/doc'
import { graph, node } from '@/lib/graph/testing'
import { migrate } from './migrate'

describe('migrate', () => {
  const current = graph([node('uv', 'uv'), node('out', 'output')], [['uv.x', 'out.color']])
  const old = { ...current, version: 3 }

  it('takes version 3 to 4 changing only the version', () => {
    expect(migrate(old)).toEqual({ ...old, version: 4 })
    expect(GRAPH_VERSION).toBe(4)
  })

  it('leaves its input alone', () => {
    const before = structuredClone(old)
    migrate(old)
    expect(old).toEqual(before)
  })

  it('returns a version 4 doc unchanged, so a second pass does nothing', () => {
    expect(migrate(current)).toBe(current)
    expect(migrate(migrate(old))).toEqual(migrate(old))
  })
})
