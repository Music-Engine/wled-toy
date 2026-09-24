import { describe, expect, it } from 'vitest'
import { defineNode, type NodeItemOptions } from './define'
import { AudioStream, Bool, Color, Enum, Float, GenType, Vec4 } from './socket-types'

const base = { title: 'Test', description: 'test', category: 'signal', input: {}, output: { value: Float } } as const
const pixel = () => ({ value: { expr: '0.0', type: 'float' } }) as const
const frame = () => ({ value: 0 })
const define = (options: Partial<NodeItemOptions<{}, typeof base.output, any>>) => () => defineNode('t', { ...base, ...options })

describe('node state at definition time', () => {
  it('keeps a pixel-scope node with a pixel body and number or vector slots', () => {
    expect(defineNode('t', { ...base, state: { a: Float, b: Color, c: Vec4 }, stateScope: 'pixel', pixel }).base.stateScope).toBe('pixel')
  })

  it.each([
    ['a frame body beside the pixel body', { pixel, frame }],
    ['a frame body alone', { frame }],
  ])('refuses pixel-scope state on a node with %s', (_, bodies) => {
    expect(define({ state: { a: Float }, stateScope: 'pixel', ...bodies })).toThrow('t: only a pixel-only node can hold pixel-scope state; a frame body has no pixel to keep it for')
  })

  it.each([
    ['Boolean', Bool],
    ['Option', Enum([{ value: 'a', label: 'A' }])],
    ['Audio', AudioStream],
    ['Number or vector', GenType],
  ])('refuses a %s slot in pixel scope and names it', (label, type) => {
    expect(define({ state: { a: Float, b: type }, stateScope: 'pixel', pixel })).toThrow(`t.b: pixel-scope state holds a number or a vector of 1 to 4 components, not ${label}`)
  })

  it('still refuses frame-scope state on a node with a pixel body', () => {
    expect(define({ state: { a: Float }, pixel, frame })).toThrow('t: only a frame-only node can hold frame-scope state; a pixel body needs stateScope pixel')
  })
})
