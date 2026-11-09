/**
 * `T` = stored JSON shape, what a store-only socket's body gets; `Linked` = what a linked socket passes; `kind`: number
 * or vector (`value`), store-only (`param`), compile-time stream (`stream`)
 */
export interface DataType<T = unknown, Linked = T> {
  /** Type-only views for the node API, never set at runtime */
  readonly _stored?: T
  readonly _linked?: Linked
  id: string
  label: string
  kind: 'value' | 'param' | 'stream'
  check(raw: unknown): raw is T
  initial(): T
  /** Passed to every widget editing this type */
  props?: Record<string, unknown>
  castableFrom: readonly string[]
  /** Components; absent when generic or not a number */
  dim?: number
}

export function canCast(from: DataType<any>, to: DataType<any>): boolean {
  return from.id === to.id || to.castableFrom.includes(from.id)
}

export interface EnumOption<V extends string = string> {
  value: V
  label: string
  /** Column heading in a grouped popup, e.g. Math's Functions / Comparison / Rounding */
  group?: string
}

export interface ImplicitDefault {
  expr: string
  label: string
  /** Reads only uniforms, so the frame pass has it too; else an unlinked socket runs the node per pixel */
  inFramePass?: true
}

export const isImplicit = (value: unknown): value is ImplicitDefault =>
  typeof value === 'object' && value !== null && ['expr', 'label'].every((key) => key in value)
