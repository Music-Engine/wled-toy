import type { GlslType } from '@/lib/shader/catalog'
import type { DataType } from '@/lib/graph/define/types'
import { castTo, componentCount, floatLiteral, vectorLiteral, type Value } from '@/lib/graph/define/value'

/** Value types only; anything else here is a compiler bug */
export function toGlslForm(type: DataType<any>): GlslForm {
  const form = GLSL[type.id]
  if (!form) throw new Error(`${type.label} has no GLSL form`)
  return form
}

interface GlslForm {
  type: GlslType
  toLiteral(raw: unknown): Value
  cast(value: Value): Value
}

const GLSL: Record<string, GlslForm> = {
  float: createNumericForm('float', floatLiteral),
  int: createNumericForm('int', (raw) => ({ expr: String(raw), type: 'int' })),
  vec2: createNumericForm('vec2', vectorLiteral),
  vec3: createNumericForm('vec3', vectorLiteral),
  color: createNumericForm('vec3', vectorLiteral),
  vec4: createNumericForm('vec4', vectorLiteral),
  // `width` already resolved the width; only a non-number is rejected
  genType: {
    type: 'genType',
    toLiteral: (raw: number | number[]) => (Array.isArray(raw) ? vectorLiteral(raw) : floatLiteral(raw)),
    cast: (value) => {
      if (componentCount(value.type) === undefined) throw new Error(`Cannot cast ${value.type} to a number or vector`)
      return value
    },
  },
  sampler2D: {
    type: 'sampler2D',
    toLiteral: () => ({ expr: 'iImage', type: 'sampler2D' }),
    cast: (value) => {
      if (value.type !== 'sampler2D') throw new Error(`Cannot cast ${value.type} to sampler2D`)
      return value
    },
  },
}

function createNumericForm(type: GlslType, toLiteral: GlslForm['toLiteral']): GlslForm {
  return { type, toLiteral, cast: (value) => castTo(value, type) }
}
