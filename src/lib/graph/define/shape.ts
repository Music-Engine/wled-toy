import type { CategoryId } from '@/lib/shader/glsl'
import type { FrameInfo, FrameValue, GlslChunk, NodeContext, ResolveEnv } from './context'
import { isGlslType, isStreamType, type DataType, type GlslTypeDef, type ImplicitDefault, type LinkType, type StreamType } from './types'
import type { Value } from './value'

export type WidgetProps = Record<string, unknown> | ((values: Record<string, unknown>) => Record<string, unknown>)

export interface InputSocket {
  name: string
  label: string
  type: DataType<any>
  connectable: boolean
  default: unknown | ImplicitDefault
  props: WidgetProps
}

export interface LinkedInputSocket extends InputSocket {
  type: GlslTypeDef<any>
  connectable: true
}

export interface StreamInputSocket extends InputSocket {
  type: StreamType<any>
  connectable: true
}

export interface OutputSocket {
  name: string
  label: string
  type: LinkType
}

/** One node at one set of values: its sockets and its code. */
export interface NodeShape {
  title: string
  signature: string
  isOutput: boolean
  includes: GlslChunk[]
  inputs: InputSocket[]
  outputs: OutputSocket[]
  exec?(input: Record<string, any>, ctx: NodeContext): Record<string, Value>
  run?(input: Record<string, any>, state: any, frame: FrameInfo): Record<string, FrameValue>
  resolve?(input: Record<string, any>, env: ResolveEnv): Record<string, unknown>
  state?(): unknown
  standalone: Partial<Record<string, string>>
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
}

/** Where a node's values live: `frame` sockets are drawn as diamonds and refuse per-pixel links. */
export const placement = (shape: NodeShape): 'frame' | 'pixel' | 'either' => (shape.run && !shape.exec ? 'frame' : shape.exec && !shape.run ? 'pixel' : 'either')

export const isImplicit = (value: unknown): value is ImplicitDefault =>
  typeof value === 'object' && value !== null && 'expr' in value && 'label' in value

/** Linked to a number or vector, in the shader or per frame. */
export const isLinkable = (socket: InputSocket): socket is LinkedInputSocket => socket.connectable && isGlslType(socket.type)
/** Linked to a stream that is resolved while the graph compiles. */
export const isStreamSocket = (socket: InputSocket): socket is StreamInputSocket => socket.connectable && isStreamType(socket.type)
/** What a connectable socket accepts, for validating links and coloring them. */
export const linkType = (socket: InputSocket): LinkType | undefined => (socket.connectable ? (socket.type as LinkType) : undefined)
