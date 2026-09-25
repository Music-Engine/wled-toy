import { reactive } from 'vue'
import { describe, expect, it } from 'vitest'
import { cloneJson, sameJson } from './json'

describe('cloneJson', () => {
  it('copies deeply and drops what JSON cannot hold', () => {
    const source = { a: [1, { b: 2 }], skip: undefined }
    const copy = cloneJson(source)
    expect(copy).toEqual({ a: [1, { b: 2 }] })
    expect(copy.a[1]).not.toBe(source.a[1])
  })

  it('unwraps a reactive proxy into plain data', () => {
    const copy = cloneJson(reactive({ nested: { value: 1 } }))
    expect(structuredClone(copy)).toEqual({ nested: { value: 1 } })
  })
})

describe('sameJson', () => {
  it('compares serializations, so key order and undefined keys decide as JSON.stringify does', () => {
    expect(sameJson({ a: 1, b: [2] }, { a: 1, b: [2] })).toBe(true)
    expect(sameJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false)
    expect(sameJson({ a: 1, c: undefined }, { a: 1 })).toBe(true)
    expect(sameJson([0.1, 'x'], [0.1, 'y'])).toBe(false)
  })
})
