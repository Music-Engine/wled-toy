import { describe, expect, expectTypeOf, it } from 'vitest'
import { DEFAULT_OUTPUT } from '@/lib/engine/output/output'
import type { ResolveResult } from './context'
import type { NodeDefinition } from './define'
import { AudioStream, Color, Enum, Float, GenType, Vec3 } from './socket-types'
import type { Value } from './value'

const input = {
  amount: Float,
  mode: {
    type: Enum([
      { value: 'add', label: 'Add' },
      { value: 'multiply', label: 'Multiply' },
    ]),
    connectable: false as const,
  },
  audio: AudioStream,
  mixed: GenType,
  position: Vec3,
}
const output = { level: Float, result: GenType }

type Options = NodeDefinition<typeof input, typeof output>
type Body = NonNullable<Options['body']>
type BodyInput = Parameters<Body>[0]

describe('what a node body receives', () => {
  it('gets an expression for a linked Float', () => {
    expectTypeOf<BodyInput['amount']>().toEqualTypeOf<Value>()
  })

  it('gets the stored option for an Enum', () => {
    expectTypeOf<BodyInput['mode']>().toEqualTypeOf<'add' | 'multiply'>()
  })

  it('gets the resolved stream or null', () => {
    expectTypeOf<BodyInput['audio']>().toEqualTypeOf<{ source: true } | null>()
  })

  it('gets an expression for a GenType and a Vec3 input', () => {
    expectTypeOf<BodyInput['mixed']>().toEqualTypeOf<Value>()
    expectTypeOf<BodyInput['position']>().toEqualTypeOf<Value>()
  })

  it('rejects an expression used as text', () => {
    const body = (({ amount }, ctx) => {
      // @ts-expect-error a linked Float reaches the body as an expression
      const text: string = amount
      return { level: ctx.declare('float', text), result: amount }
    }) satisfies Body
    expectTypeOf(body).toBeFunction()
  })
})

describe('what a node body returns', () => {
  it('returns expressions', () => {
    expectTypeOf<ReturnType<Body>>().toEqualTypeOf<{ level: Value; result: Value }>()
  })
})

describe('what a body finds in ctx.state', () => {
  const state = { level: Float, tint: Color }
  type StatefulBody = NonNullable<NodeDefinition<typeof input, typeof output, typeof state>['body']>

  it('gets each slot as a value it assigns through emit', () => {
    expectTypeOf<Parameters<StatefulBody>[1]['state']>().toEqualTypeOf<{ readonly level: Value; readonly tint: Value }>()
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
