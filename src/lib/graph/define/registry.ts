import { CATALOG_FUNCTIONS, CATALOG_UNIFORMS } from '@/lib/graph/nodes/catalog'
import type { GraphNodeData } from '@/lib/graph/model/doc'
import type { InputSocket, NodeItem, NodeShape, OutputSocket } from './node'
import * as nodes from '@/lib/graph/nodes'
import { canCast, type LinkType } from './types'

const items = new Map<string, NodeItem>()
const isNodeItem = (value: unknown): value is NodeItem => typeof value === 'object' && value !== null && 'shape' in value && 'base' in value

for (const item of [...CATALOG_UNIFORMS, ...CATALOG_FUNCTIONS, ...Object.values(nodes).filter(isNodeItem)]) {
  if (items.has(item.id)) throw new Error(`Duplicate graph node id "${item.id}"`)
  items.set(item.id, item)
}

export const itemFor = (kind: string) => items.get(kind)
export const allItems = () => [...items.values()]

/** A connectable input and what it accepts. */
export type LinkableInput = InputSocket & { type: LinkType }

const linkable = (shape: NodeShape) => shape.inputs.filter((s): s is LinkableInput => s.connectable)

/** The shape a stored node has right now; undefined for an unknown kind. */
export const storedShape = (data: GraphNodeData | undefined): NodeShape | undefined => data && itemFor(data.kind)?.shape(data.values)

export function inputSocket(data: GraphNodeData | undefined, handle: string | null | undefined): LinkableInput | undefined {
  const shape = storedShape(data)
  return shape && linkable(shape).find((s) => s.name === handle)
}

export function outputSocket(data: GraphNodeData | undefined, handle: string | null | undefined): OutputSocket | undefined {
  return storedShape(data)?.outputs.find((s) => s.name === handle)
}

/** First socket of a node `shape` (the menu uses a kind's base shape) that can link to a dragged socket of `type`. */
export function firstCompatibleSocket(shape: NodeShape, type: LinkType, need: 'in' | 'out'): LinkableInput | OutputSocket | undefined {
  return need === 'in'
    ? linkable(shape).find((s) => canCast(type, s.type))
    : shape.outputs.find((s) => canCast(s.type, type))
}
