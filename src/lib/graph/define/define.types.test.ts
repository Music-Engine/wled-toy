import { describe, expect, expectTypeOf, it } from 'vitest'
import type { NodeItemOptions } from './define'
import { AudioStream, Enum, Float, GenType, Vec3 } from './socket-types'
import type { Value } from './value'

const input = {
  amount: Float,
  mode: { type: Enum([{ value: 'add', label: 'Add' }, { value: 'multiply', label: 'Multiply' }]), connectable: false as const },
  audio: AudioStream,
  mixed: GenType,
  position: Vec3,
}
const output = { level: Float, result: GenType }

type Options = NodeItemOptions<typeof input, typeof output>
type Exec = NonNullable<Options['exec']>
type Run = NonNullable<Options['run']>
type ExecInput = Parameters<Exec>[0]
type RunInput = Parameters<Run>[0]

describe('what a node body receives', () => {
  it('gets an expression per pixel and a number per frame for a linked Float', () => {
    expectTypeOf<ExecInput['amount']>().toEqualTypeOf<Value>()
    expectTypeOf<RunInput['amount']>().toEqualTypeOf<number>()
  })

  it('gets the stored option in both bodies for a connectable: false Enum', () => {
    expectTypeOf<ExecInput['mode']>().toEqualTypeOf<'add' | 'multiply'>()
    expectTypeOf<RunInput['mode']>().toEqualTypeOf<'add' | 'multiply'>()
  })

  it('gets the resolved stream or null in both bodies', () => {
    expectTypeOf<ExecInput['audio']>().toEqualTypeOf<{ source: true } | null>()
    expectTypeOf<RunInput['audio']>().toEqualTypeOf<{ source: true } | null>()
  })

  it('gets a number or a vector per frame for a GenType input', () => {
    expectTypeOf<ExecInput['mixed']>().toEqualTypeOf<Value>()
    expectTypeOf<RunInput['mixed']>().toEqualTypeOf<number | number[]>()
  })

  it('gets the components per frame for a linked Vec3', () => {
    expectTypeOf<RunInput['position']>().toEqualTypeOf<number[]>()
  })

  it('rejects a per-frame Float used as text, and an expression where run expects a number', () => {
    const run = (({ amount }) => {
      // @ts-expect-error a linked Float reaches run as a number
      const text: string = amount
      return { level: text.length, result: 0 }
    }) satisfies Run
    expectTypeOf(run).toBeFunction()

    const value: Value = { expr: 'x', type: 'float' }
    // @ts-expect-error run takes numbers, not GLSL expressions
    const frameInput: RunInput['amount'] = value
    expectTypeOf(frameInput).toBeNumber()
  })
})

describe('what a node body returns', () => {
  it('returns expressions per pixel', () => {
    expectTypeOf<ReturnType<Exec>>().toEqualTypeOf<{ level: Value; result: Value }>()
  })

  it('returns a number for a Float and a number or a possibly readonly vector for a GenType per frame', () => {
    expectTypeOf<ReturnType<Run>>().toEqualTypeOf<{ level: number; result: number | number[] | readonly number[] }>()
  })
})

it('keeps the views out of the runtime value', () => {
  expect(Object.keys(Float)).toEqual(['id', 'label', 'glsl', 'check', 'initial', 'literal', 'color', 'castableFrom', 'cast'])
})
