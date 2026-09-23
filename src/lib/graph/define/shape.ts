import type { CategoryId } from '@/lib/shader/glsl'
import type { FrameContext, FrameValue, GlslChunk, NodeContext, ResolveResult, Resources } from './context'
import type { DataType, ImplicitDefault } from './types'
import type { Value } from './value'

export type WidgetProps = Record<string, unknown> | ((values: Record<string, unknown>) => Record<string, unknown>)

/** An input. Unlinked, it reads `default`: a stored literal, or an expression the shader evaluates (see ImplicitDefault). */
export interface Socket {
  name: string
  label: string
  type: DataType<any>
  linkable: boolean
  default: unknown | ImplicitDefault
  props: WidgetProps
}

export interface OutputSocket {
  name: string
  label: string
  type: DataType<any>
}

/** One node at one set of values: its sockets and its code. */
export interface NodeShape {
  title: string
  signature: string
  isOutput: boolean
  includes: GlslChunk[]
  inputs: Socket[]
  outputs: OutputSocket[]
  pixel?(input: Record<string, any>, ctx: NodeContext): Record<string, Value>
  frame?(input: Record<string, any>, info: FrameContext): Record<string, FrameValue>
  resolve?(input: Record<string, any>, resources: Resources): ResolveResult
  state?(): unknown
}

/**
 * A node kind. Its shape is a function of the node's stored values, so a parameter can change what sockets it has
 * and what it computes: a Math node set to Sine has one Value input, set to Wrap it has Value, Min and Max.
 */
export interface NodeItem {
  id: string
  title: string
  description: string
  category: CategoryId
  shape(values: Record<string, unknown>): NodeShape
  /** The shape with nothing set: what the menu lists and previews. */
  base: NodeShape
  presets?: NodePreset[]
}

/** The node started with `values`, listed in the menu as an entry of its own; `group` files it under a sub-directory. */
export interface NodePreset {
  title: string
  group?: string
  values: Record<string, unknown>
}

/** Where a node's values live: `frame` sockets are drawn as diamonds and refuse per-pixel links. */
export function placement(shape: NodeShape): 'frame' | 'pixel' | 'either' {
  if (shape.frame && !shape.pixel) return 'frame'
  if (shape.pixel && !shape.frame) return 'pixel'
  return 'either'
}
