import type { GlslType } from '@/lib/shader/glsl'

/** A GLSL expression and the concrete type it evaluates to. */
export interface Value {
  expr: string
  type: GlslType
}

/** Component count of a numeric type; undefined for matrices, samplers and void. */
export const componentCount = (type: GlslType): number | undefined => ({ float: 1, int: 1, vec2: 2, vec3: 3, vec4: 4 } as Partial<Record<GlslType, number>>)[type]
export const vectorType = (dim: number): GlslType => (['float', 'vec2', 'vec3', 'vec4'] as const)[dim - 1] ?? 'vec3'

export function fmt(v: number): string {
  const s = String(Number.isFinite(v) ? Math.round(v * 10000) / 10000 : 0)
  return /[.e]/.test(s) ? s : `${s}.0`
}

export const floatLiteral = (v: number): Value => ({ expr: fmt(v), type: 'float' })

export function vectorLiteral(components: number[]): Value {
  const type = vectorType(components.length)
  return { expr: `${type}(${components.map(fmt).join(', ')})`, type }
}

/** Component access such as `.xy` or `.r`; throws on components the value does not have. */
export function swizzle(value: Value, components: string): Value {
  const dim = componentCount(value.type)
  const valid = dim !== undefined && dim > 1 && components.length >= 1 && components.length <= 4
    && ['xyzw', 'rgba'].some((set) => [...components].every((c) => set.slice(0, dim).includes(c)))
  if (!valid) throw new Error(`Invalid swizzle .${components} on ${value.type}`)
  const target = /^[\w.]+$/.test(value.expr) ? value.expr : `(${value.expr})`
  return { expr: `${target}.${components}`, type: vectorType(components.length) }
}

/**
 * Numeric conversion between float, int and vectors. Scalars spread to every component,
 * wider vectors are truncated, narrower ones are padded with 0 (and alpha 1 for vec4).
 */
export function castTo(value: Value, to: GlslType): Value {
  const { expr, type: from } = value
  if (from === to) return value
  if (from === 'int') return castTo({ expr: `float(${expr})`, type: 'float' }, to)
  if (to === 'int') return { expr: `int(${castTo(value, 'float').expr})`, type: 'int' }
  const f = componentCount(from)
  const t = componentCount(to)
  if (f === undefined || t === undefined) throw new Error(`Cannot cast ${from} to ${to}`)
  if (f === 1) return { expr: `${to}(${expr})`, type: to }
  if (f > t) return swizzle(value, 'xyzw'.slice(0, t))
  if (t !== 4) return { expr: `${to}(${expr}, 0.0)`, type: to }
  const pad = f === 2 ? ', 0.0, 1.0' : ', 1.0'
  return { expr: `${to}(${expr}${pad})`, type: to }
}
