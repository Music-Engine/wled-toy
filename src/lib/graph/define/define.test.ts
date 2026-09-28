import { describe, expect, it } from 'vitest'
import { defineNode, type NodeDefinition } from './define'
import { AudioStream, Bool, Color, Enum, Float, GenType, Vec4 } from './socket-types'

const base = { title: 'Test', description: 'test', category: 'signal', input: {}, output: { value: Float } } as const
const body = () => ({ value: { expr: '0.0', type: 'float' } }) as const
const resolve = () => ({})
const define = (options: Partial<NodeDefinition<{}, typeof base.output, any>>) => () => defineNode('t', { ...base, ...options })

describe('node state at definition time', () => {
  it('keeps number or vector slots', () => {
    expect(defineNode('t', { ...base, state: { a: Float, b: Color, c: Vec4 }, body }).base.state).toEqual({ a: Float, b: Color, c: Vec4 })
  })

  it.each([
    ['Boolean', Bool],
    ['Option', Enum([{ value: 'a', label: 'A' }])],
    ['Audio', AudioStream],
    ['Number or vector', GenType],
  ])('refuses a %s slot and names it', (label, type) => {
    expect(define({ state: { a: Float, b: type }, body })).toThrow(`t.b: shader state holds a number or a vector of 1 to 4 components, not ${label}`)
  })
})

describe('a definition with one body', () => {
  it('hands the body and resolve to the shape', () => {
    const { base: shape } = defineNode('t', { ...base, body, resolve })
    expect(shape.body).toBe(body)
    expect(shape.resolve).toBe(resolve)
  })

  it('takes resolve alone, for a node whose outputs are uniforms', () => {
    expect(defineNode('t', { ...base, resolve }).base.body).toBeUndefined()
  })

  it('refuses a node with no body or resolve', () => {
    expect(define({})).toThrow('t: a node needs body or resolve')
  })
})
