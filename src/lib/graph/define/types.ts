export interface ImplicitDefault {
  expr: string
  label: string
  /** The same value once per frame, for a node that runs on the CPU; without it the socket needs a link there. */
  frame?: 'time'
}

export const isImplicit = (value: unknown): value is ImplicitDefault =>
  typeof value === 'object' && value !== null && ['expr', 'label'].every((key) => key in value)

/**
 * A type a node stores in its values. `T` is the stored (JSON) shape; `Frame` and `Pixel` are what a node body receives
 * and returns for it once per frame and per pixel. `kind` says what a link of it carries: a number or vector (`value`),
 * nothing because the socket only stores (`param`), or a stream settled while the graph compiles (`stream`).
 */
export interface DataType<T = unknown, Frame = T, Pixel = T> {
  /** Type-only views read by the node API; never set at runtime, optional so a node can declare its own stored type. */
  readonly _frame?: Frame
  readonly _pixel?: Pixel
  id: string
  label: string
  kind: 'value' | 'param' | 'stream'
  check(raw: unknown): raw is T
  initial(): T
  /** Passed to every widget that edits this type. */
  props?: Record<string, unknown>
  castableFrom: readonly string[]
  /** Components of a number or vector; absent where the width is not fixed (generic) or not a number. */
  dim?: number
}

export function canCast(from: DataType<any>, to: DataType<any>): boolean {
  return from.id === to.id || to.castableFrom.includes(from.id)
}

export interface EnumOption<V extends string = string> {
  value: V
  label: string
  /** Column heading in a grouped popup, e.g. Blender's Functions / Comparison / Rounding for Math. */
  group?: string
}
