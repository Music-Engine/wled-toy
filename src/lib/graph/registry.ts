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

export const findNodeItem = (kind: string) => items.get(kind)
export const listItems = () => [...items.values()]

const listLinkable = (shape: NodeShape) => shape.inputs.filter((socket) => socket.linkable)

/** Undefined for an unknown kind */
export const readStoredShape = (data: GraphNodeData | undefined): NodeShape | undefined => data && findNodeItem(data.kind)?.shape(data.values)

export function findInputSocket(data: GraphNodeData | undefined, handle: string | null | undefined): Socket | undefined {
  const shape = readStoredShape(data)
  return shape && listLinkable(shape).find((socket) => socket.name === handle)
}

export function findOutputSocket(data: GraphNodeData | undefined, handle: string | null | undefined): OutputSocket | undefined {
  return readStoredShape(data)?.outputs.find((socket) => socket.name === handle)
}

/** First socket of `shape` (menu: a kind's base shape) that links to a dragged socket of `type` */
export function findCompatibleSocket(shape: NodeShape, type: DataType<any>, need: 'in' | 'out'): Socket | OutputSocket | undefined {
  return need === 'in' ? listLinkable(shape).find((socket) => canCast(type, socket.type)) : shape.outputs.find((socket) => canCast(socket.type, type))
}

/** Inputs a number or vector links into */
export const listValueInputs = (shape: NodeShape): Socket[] => listLinkable(shape).filter((socket) => socket.type.kind === 'value')

/** Nothing stored, so unlinked it reads its implicit expression */
export const fallsBackToImplicit = (values: Record<string, unknown>, socket: Socket): socket is Socket & { default: ImplicitDefault } =>
  values[socket.name] === undefined && isImplicit(socket.default)

/** Implicit expression also in the frame pass, so reading it keeps the node there */
export const existsInFramePass = (socket: Socket): boolean => isImplicit(socket.default) && socket.default.inFramePass === true
