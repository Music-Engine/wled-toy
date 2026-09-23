import type { GlslType } from '@/lib/shader/glsl'
import type { FrameInfo } from './context'
import type { Value } from './value'

export interface ImplicitDefault {
  expr: string
  label: string
  /** The same value once per frame, for a node that runs on the CPU; without it the socket needs a link there. */
  frame?: (frame: FrameInfo) => number
}

/** A type a node stores in its values. `T` is the stored (JSON) shape. */
export interface DataType<T = unknown> {
  id: string
  label: string
  check(raw: unknown): raw is T
  initial(): T
  /** Passed to every widget that edits this type. */
  props?: Record<string, unknown>
}

/** A data type that also exists in GLSL, so sockets of it can be linked. */
export interface GlslTypeDef<T = unknown> extends DataType<T> {
  glsl: GlslType
  color: string
  castableFrom: readonly string[]
  cast(value: Value): Value
  literal(raw: T): Value
  /** What an unlinked socket evaluates to when the type has no editable literal. */
  implicit?: ImplicitDefault
}

/**
 * A type that is linked but never becomes a number: an audio stream, a spectrum. What flows along such a link is decided
 * while the graph compiles (see `resolve` in defineNode), so it costs nothing per frame. `T` is what the receiving node gets.
 */
export interface StreamType<T = unknown> extends DataType<T | null> {
  struct: true
  color: string
  castableFrom: readonly string[]
  /** Shown on an unlinked socket: what it uses when nothing is linked. */
  unlinked: string
}

/** Anything a link can carry. */
export type LinkType = GlslTypeDef<any> | StreamType<any>

export const isGlslType = (type: DataType<any>): type is GlslTypeDef<any> => 'glsl' in type
export const isStreamType = (type: DataType<any>): type is StreamType<any> => 'struct' in type

export function canCast(from: LinkType, to: LinkType): boolean {
  return from.id === to.id || to.castableFrom.includes(from.id)
}

export interface EnumOption<V extends string = string> {
  value: V
  label: string
  /** Column heading in a grouped popup, e.g. Blender's Functions / Comparison / Rounding for Math. */
  group?: string
}
