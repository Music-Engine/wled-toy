import type { CategoryId } from '@/lib/shader/catalog'
import type { GlslChunk, NodeContext, ResolveResult, Resources } from './context'
import type { DataType, ImplicitDefault } from './types'
import type { Value } from './value'

/** Shape depends on stored values: Math set to Sine has one input, set to Wrap three */
export interface NodeItem {
  id: string
  title: string
  description: string
  category: CategoryId
  shape(values: Record<string, unknown>): NodeShape
  /** Nothing set: what the menu lists and previews */
  base: NodeShape
  presets?: NodePreset[]
}

/** Node at one set of values */
export interface NodeShape {
  title: string
  signature: string
  isOutput: boolean
  includes: GlslChunk[]
  inputs: Socket[]
  outputs: OutputSocket[]
  body?(input: Record<string, any>, ctx: NodeContext): Record<string, Value>
  varies?: 'pixel'
  prefers?: 'frame'
  probe?: string
  resolve?(input: Record<string, any>, resources: Resources): ResolveResult
  /** Slot name to type */
  state?: Record<string, DataType<any>>
}

/** Unlinked reads `default`: stored literal or implicit expression */
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

export type WidgetProps = Record<string, unknown> | ((values: Record<string, unknown>) => Record<string, unknown>)

/** Menu entry starting the node w/ `values`; `group` = sub-directory */
export interface NodePreset {
  title: string
  group?: string
  values: Record<string, unknown>
}
