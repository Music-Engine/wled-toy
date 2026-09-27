import type { Connection, VueFlowStore } from '@vue-flow/core'
import { socketColor } from '@/features/node-ui/sockets'
import { log } from '@/lib/app/logs'
import { canConnect } from '@/lib/documents/edits/links'
import { inputSocket, outputSocket, type DataType, type GraphNodeData } from '@/lib/graph'
import { newId } from '@/lib/util/ids'

/**
 * Blender's link gestures: a link dropped on nothing offers the nodes it can attach to, one pulled off a connected input
 * and dropped on nothing is removed, and a link end dragged away from its socket is removed.
 */
export function useLinkDrag(flow: VueFlowStore, offerNodes: (at: { x: number; y: number }, pending: PendingLink) => void) {
  let dragFrom: PendingLink | null = null
  let dragConnected = false

  flow.onConnectStart(({ nodeId, handleId, handleType }) => {
    dragConnected = false
    const socket = nodeId && handleType ? (handleType === 'source' ? outputSocket : inputSocket)(dataOf(flow, nodeId), handleId) : undefined
    const type = socket?.type
    dragFrom = nodeId && handleId && handleType && type ? { nodeId, handleId, handleType, type } : null
  })

  flow.onConnect((c) => {
    dragConnected = true
    connectLink(flow, c)
  })

  flow.onConnectEnd((event) => {
    const from = dragFrom
    dragFrom = null
    if (!from || !event) return
    // onConnect for the same gesture can land after this hook, so decide on the next tick
    setTimeout(() => {
      if (dragConnected || !droppedOnEmpty(event)) return
      const existing = from.handleType === 'target'
        ? flow.edges.value.filter((e) => e.target === from.nodeId && e.targetHandle === from.handleId)
        : []
      if (existing.length) {
        flow.removeEdges(existing.map((e) => e.id))
        log('Link removed')
        return
      }
      const point = pointOf(event)
      offerNodes({ x: point.clientX, y: point.clientY }, from)
    }, 0)
  })

  let edgeDrag = { updated: false, x: 0, y: 0 }

  flow.onEdgeUpdateStart(({ event }) => {
    const point = pointOf(event)
    edgeDrag = { updated: false, x: point.clientX, y: point.clientY }
  })

  flow.onEdgeUpdate(({ edge, connection }) => {
    if (!canConnect(connection, (id) => dataOf(flow, id))) return
    edgeDrag.updated = true
    flow.removeEdges([edge.id])
    connectLink(flow, connection)
  })

  flow.onEdgeUpdateEnd(({ edge, event }) => {
    setTimeout(() => {
      if (edgeDrag.updated) return
      const point = pointOf(event)
      // a click on the link end without dragging should not delete it
      if (Math.hypot(point.clientX - edgeDrag.x, point.clientY - edgeDrag.y) < 4) return
      flow.removeEdges([edge.id])
      log('Link removed')
    }, 0)
  })

  return { isValidConnection: (c: Connection) => canConnect(c, (id) => dataOf(flow, id)) }
}

/** Adds a link; an input holds one link, so an existing one is replaced like in Blender. */
export function connectLink(flow: VueFlowStore, c: Connection): boolean {
  if (!canConnect(c, (id) => dataOf(flow, id))) return false
  const replaced = flow.edges.value.filter((e) => e.target === c.target && e.targetHandle === c.targetHandle)
  if (replaced.length) flow.removeEdges(replaced.map((e) => e.id))
  const from = outputSocket(dataOf(flow, c.source), c.sourceHandle)!
  flow.addEdges([{
    ...c,
    id: `e-${c.source}-${c.sourceHandle}-${c.target}-${c.targetHandle}-${newId()}`,
    style: { stroke: socketColor(from.type), strokeWidth: 2 },
  }])
  return true
}

/** The socket a link is being dragged from, while the add-node menu it opened is up. */
export interface PendingLink {
  nodeId: string
  handleId: string
  handleType: 'source' | 'target'
  type: DataType<any>
}

const dataOf = (flow: VueFlowStore, id: string) => flow.findNode(id)?.data as GraphNodeData | undefined
const pointOf = (event: MouseEvent | TouchEvent) => ('changedTouches' in event ? event.changedTouches[0] : event)
const droppedOnEmpty = (event: MouseEvent | TouchEvent) => !(event.target as Element | null)?.closest('.vue-flow__node, .vue-flow__handle')
