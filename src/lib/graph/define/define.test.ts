import { describe, expect, it } from 'vitest'
import { defineNode, type NodeDefinition } from './define'
import { AudioStream, Bool, Color, Enum, Float, GenType, Vec4 } from './socket-types'

const base = { title: 'Test', description: 'test', category: 'signal', input: {}, output: { value: Float } } as const
const body = () => ({ value: { expr: '0.0', type: 'float' } }) as const
const frame = () => ({ value: 0 })
const define = (options: Partial<NodeDefinition<{}, typeof base.output, any>>) => () => defineNode('t', { ...base, ...options })

describe('node state at definition time', () => {
  it('keeps number or vector slots beside a body, in pixel state for the old pipeline', () => {
    expect(defineNode('t', { ...base, state: { a: Float, b: Color, c: Vec4 }, body }).base.stateScope).toBe('pixel')
  })

  it.each([
    ['Boolean', Bool],
    ['Option', Enum([{ value: 'a', label: 'A' }])],
    ['Audio', AudioStream],
    ['Number or vector', GenType],
  ])('refuses a %s slot beside a body and names it', (label, type) => {
    expect(define({ state: { a: Float, b: type }, body })).toThrow(`t.b: shader state holds a number or a vector of 1 to 4 components, not ${label}`)
  })

  it('keeps any slot on a node with only a frame body, in frame state', () => {
    expect(defineNode('t', { ...base, state: { a: Bool }, frame }).base.stateScope).toBe('frame')
  })
})

describe('a definition with one body', () => {
  it('needs no frame body, and the old pipeline runs the body as its pixel body', () => {
    const item = defineNode('t', { ...base, body })
    expect(item.base.body).toBe(body)
    expect(item.base.pixel).toBe(body)
  })

  it('refuses pixel, which body replaces', () => {
    expect(define({ body, pixel: body } as never)).toThrow('t: pixel is now body')
  })

  it('refuses a node with no body, frame or resolve', () => {
    expect(define({})).toThrow('t: a node needs body, frame or resolve')
  })

  it('leaves the old pipeline both bodies beside a frame body', () => {
    expect(defineNode('t', { ...base, state: { a: Float }, body, frame }).base).toMatchObject({ pixel: body, frame, stateScope: 'pixel' })
  })

  it('leaves the old pipeline only the frame body, with frame state, when frameOnlyInOldPipeline is set', () => {
    const shape = defineNode('t', { ...base, state: { a: Float }, body, frame, frameOnlyInOldPipeline: true }).base
    expect(shape).toMatchObject({ frame, stateScope: 'frame' })
    expect(shape.pixel).toBeUndefined()
  })

  it('refuses frameOnlyInOldPipeline without both bodies', () => {
    expect(define({ body, frameOnlyInOldPipeline: true })).toThrow('t: frameOnlyInOldPipeline needs both body and frame')
  })
})
