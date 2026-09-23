import { CATALOG_FUNCTIONS, CATALOG_UNIFORMS } from '@/lib/graph/nodes/catalog'
import type { GraphNodeData } from '@/lib/graph/model/doc'
import type { NodeItem, NodeShape, OutputSocket, Socket } from '@/lib/graph/define/shape'
import { NODE_KINDS } from '@/lib/graph/nodes'
import { canCast, isImplicit, type DataType, type ImplicitDefault } from '@/lib/graph/define/types'

const items = new Map<string, NodeItem>()

for (const item of [...CATALOG_UNIFORMS, ...CATALOG_FUNCTIONS, ...NODE_KINDS]) {
  if (items.has(item.id)) throw new Error(`Duplicate graph node id "${item.id}"`)
  items.set(item.id, item)
}

export const itemFor = (kind: string) => items.get(kind)
export const allItems = () => [...items.values()]

const linkable = (shape: NodeShape) => shape.inputs.filter((s) => s.linkable)

/** The shape a stored node has right now; undefined for an unknown kind. */
export const storedShape = (data: GraphNodeData | undefined): NodeShape | undefined => data && itemFor(data.kind)?.shape(data.values)

export function inputSocket(data: GraphNodeData | undefined, handle: string | null | undefined): Socket | undefined {
  const shape = storedShape(data)
  return shape && linkable(shape).find((s) => s.name === handle)
}

export function outputSocket(data: GraphNodeData | undefined, handle: string | null | undefined): OutputSocket | undefined {
  return storedShape(data)?.outputs.find((s) => s.name === handle)
}

/** First socket of a node `shape` (the menu uses a kind's base shape) that can link to a dragged socket of `type`. */
export function firstCompatibleSocket(shape: NodeShape, type: DataType<any>, need: 'in' | 'out'): Socket | OutputSocket | undefined {
  return need === 'in'
    ? linkable(shape).find((s) => canCast(type, s.type))
    : shape.outputs.find((s) => canCast(s.type, type))
}

/** The inputs a number or vector can be linked into, in the shader or per frame. */
export const valueInputs = (shape: NodeShape): Socket[] => shape.inputs.filter((socket) => socket.linkable && socket.type.kind === 'value')

/** Nothing is stored for the socket, so unlinked it reads its implicit expression. */
export const fallsBackToImplicit = (values: Record<string, unknown>, socket: Socket): socket is Socket & { default: ImplicitDefault } =>
  values[socket.name] === undefined && isImplicit(socket.default)

/** The socket's implicit expression also exists once per frame, so a frame body can read it unlinked. */
export const hasFrameValue = (socket: Socket): boolean => isImplicit(socket.default) && socket.default.frame !== undefined
