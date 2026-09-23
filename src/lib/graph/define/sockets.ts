// Questions about sockets and shapes: how a node runs, what a socket links to, and how a socket declaration becomes a socket.
import { titleCase } from '@/lib/shader/glsl'
import { isGlslType, isStreamType, type ImplicitDefault, type LinkType } from './types'
import type { InputDef, InputSocket, LinkedInputDef, LinkedInputSocket, NodeShape, OutputDef, OutputSocket, StoredInputDef, StreamInputDef, StreamInputSocket } from './node'

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

export function buildInputSocket(item: string, name: string, def: InputDef): InputSocket {
  const options = ('type' in def ? def : { type: def }) as LinkedInputDef | StoredInputDef | StreamInputDef
  const { type } = options
  const connectable = !('connectable' in options && options.connectable === false)
  if (connectable && !isGlslType(type) && !isStreamType(type)) throw new Error(`${item}.${name}: ${type.label} has no GLSL form, so the socket must set connectable: false`)
  const fallback = ('default' in options ? options.default : undefined) ?? (isGlslType(type) && type.implicit ? type.implicit : type.initial())
  if (isImplicit(fallback) ? !connectable : !type.check(fallback)) throw new Error(`${item}.${name}: default does not fit ${type.label}`)
  return { name, label: options.label ?? titleCase(name), type, connectable, default: fallback, props: options.props ?? {} }
}

export function buildOutputSocket(item: string, name: string, def: OutputDef): OutputSocket {
  const { type, label } = 'type' in def ? def : { type: def, label: undefined }
  if (!label && name === 'out') throw new Error(`${item}: output "out" needs a label that says what it carries`)
  return { name, label: label ?? titleCase(name), type }
}
