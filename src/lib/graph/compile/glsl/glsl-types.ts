// GLSL's answer to the representation questions a value type raises, in a table keyed by type id.
import type { GlslType } from '@/lib/shader/glsl'
import type { DataType } from '@/lib/graph/define/types'
import { castTo, componentCount, floatLiteral, vectorLiteral, type Value } from '@/lib/graph/define/value'

/** The front end asks only about value types; any other reaching here is a compiler bug. */
export function glslForm(type: DataType<any>): GlslForm {
  const form = GLSL[type.id]
  if (!form) throw new Error(`${type.label} has no GLSL form`)
  return form
}

/** A value type as GLSL writes it: its type name, a stored value as a literal, and a linked value cast to it. */
interface GlslForm {
  type: GlslType
  literal(raw: unknown): Value
  cast(value: Value): Value
}

const GLSL: Record<string, GlslForm> = {
  float: numeric('float', floatLiteral),
  int: numeric('int', (raw) => ({ expr: String(raw), type: 'int' })),
  vec2: numeric('vec2', vectorLiteral),
  vec3: numeric('vec3', vectorLiteral),
  color: numeric('vec3', vectorLiteral),
  vec4: numeric('vec4', vectorLiteral),
  // the front end resolves a generic socket to the node's width, so a cast here only rejects what is not a number at all
  genType: {
    type: 'genType',
    literal: (raw: number | number[]) => (Array.isArray(raw) ? vectorLiteral(raw) : floatLiteral(raw)),
    cast: (value) => {
      if (componentCount(value.type) === undefined) throw new Error(`Cannot cast ${value.type} to a number or vector`)
      return value
    },
  },
  sampler2D: {
    type: 'sampler2D',
    literal: () => ({ expr: 'iImage', type: 'sampler2D' }),
    cast: (value) => {
      if (value.type !== 'sampler2D') throw new Error(`Cannot cast ${value.type} to sampler2D`)
      return value
    },
  },
}

function numeric(type: GlslType, literal: GlslForm['literal']): GlslForm {
  return { type, literal, cast: (value) => castTo(value, type) }
}
