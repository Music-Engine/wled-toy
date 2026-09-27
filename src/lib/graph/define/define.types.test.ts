import { describe, expect, expectTypeOf, it } from 'vitest'
import { DEFAULT_OUTPUT } from '@/lib/engine/output/output'
import type { ResolveResult } from './context'
import type { NodeDefinition } from './define'
import { AudioStream, Bool, Color, Enum, Float, GenType, Int, Vec3 } from './socket-types'
import type { Value } from './value'

const input = {
  amount: Float,
  mode: { type: Enum([{ value: 'add', label: 'Add' }, { value: 'multiply', label: 'Multiply' }]), connectable: false as const },
  audio: AudioStream,
  mixed: GenType,
  position: Vec3,
}
const output = { level: Float, result: GenType }

type Options = NodeDefinition<typeof input, typeof output>
type Pixel = NonNullable<Options['pixel']>
type Frame = NonNullable<Options['frame']>
type PixelInput = Parameters<Pixel>[0]
type FrameInput = Parameters<Frame>[0]

describe('what a node body receives', () => {
  it('gets an expression per pixel and a number per frame for a linked Float', () => {
    expectTypeOf<PixelInput['amount']>().toEqualTypeOf<Value>()
    expectTypeOf<FrameInput['amount']>().toEqualTypeOf<number>()
  })

  it('gets the stored option in both bodies for a connectable: false Enum', () => {
    expectTypeOf<PixelInput['mode']>().toEqualTypeOf<'add' | 'multiply'>()
    expectTypeOf<FrameInput['mode']>().toEqualTypeOf<'add' | 'multiply'>()
  })

  it('gets the resolved stream or null in both bodies', () => {
    expectTypeOf<PixelInput['audio']>().toEqualTypeOf<{ source: true } | null>()
    expectTypeOf<FrameInput['audio']>().toEqualTypeOf<{ source: true } | null>()
  })

  it('gets a number or a vector per frame for a GenType input', () => {
    expectTypeOf<PixelInput['mixed']>().toEqualTypeOf<Value>()
    expectTypeOf<FrameInput['mixed']>().toEqualTypeOf<number | number[]>()
  })

  it('gets the components per frame for a linked Vec3', () => {
    expectTypeOf<FrameInput['position']>().toEqualTypeOf<number[]>()
  })

  it('rejects a per-frame Float used as text, and an expression where frame expects a number', () => {
    const body = (({ amount }) => {
      // @ts-expect-error a linked Float reaches frame as a number
      const text: string = amount
      return { level: text.length, result: 0 }
    }) satisfies Frame
    expectTypeOf(body).toBeFunction()

    const value: Value = { expr: 'x', type: 'float' }
    // @ts-expect-error frame takes numbers, not GLSL expressions
    const frameInput: FrameInput['amount'] = value
    expectTypeOf(frameInput).toBeNumber()
  })
})

describe('what a node body returns', () => {
  it('returns expressions per pixel', () => {
    expectTypeOf<ReturnType<Pixel>>().toEqualTypeOf<{ level: Value; result: Value }>()
  })

  it('returns a number for a Float and a number or a possibly readonly vector for a GenType per frame', () => {
    expectTypeOf<ReturnType<Frame>>().toEqualTypeOf<{ level: number; result: number | number[] | readonly number[] }>()
  })
})

describe('what a frame body finds in info.state', () => {
  const state = { count: Int, on: Bool, stage: Enum([{ value: 'idle', label: 'Idle' }, { value: 'run', label: 'Run' }]) }
  type StatefulFrame = NonNullable<NodeDefinition<typeof input, typeof output, typeof state>['frame']>

  it('gets each slot as its type per frame, writable', () => {
    expectTypeOf<Parameters<StatefulFrame>[1]['state']>().toEqualTypeOf<{ count: number; on: boolean; stage: 'idle' | 'run' }>()
  })

  it('rejects a value that does not fit the slot type', () => {
    const body = ((_, { state: slots }) => {
      // @ts-expect-error count is an Int slot, so it holds a number
      slots.count = 'many'
      return { level: slots.count, result: 0 }
    }) satisfies StatefulFrame
    expectTypeOf(body).toBeFunction()
  })
})

describe('what a pixel body finds in ctx.state', () => {
  const state = { level: Float, tint: Color }
  type StatefulPixel = NonNullable<NodeDefinition<typeof input, typeof output, typeof state>['pixel']>

  it('gets each slot as a GLSL value it assigns through emit', () => {
    expectTypeOf<Parameters<StatefulPixel>[1]['state']>().toEqualTypeOf<{ readonly level: Value; readonly tint: Value }>()
  })
})

it('checks the wire settings an Output resolves to against OutputSettings', () => {
  const resolved: ResolveResult = {
    // @ts-expect-error gamma is a number
    output: { ...DEFAULT_OUTPUT, gamma: 'high' },
  }
  expectTypeOf(resolved.output).not.toBeUndefined()
})

it('keeps the views out of the runtime value', () => {
  expect(Object.keys(Float)).toEqual(['id', 'label', 'kind', 'check', 'initial', 'castableFrom', 'dim'])
})
