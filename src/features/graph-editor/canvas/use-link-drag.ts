import type { Connection, VueFlowStore } from '@vue-flow/core'
import { socketColor } from '@/features/node-ui/sockets'
import { log } from '@/lib/app/logs'
import { canConnect } from '@/lib/documents/edits/links'
import { findInputSocket, findOutputSocket, type DataType, type GraphNodeData } from '@/lib/graph'
import { newId } from '@/lib/util/ids'

/** Blender's link gestures: dropped on nothing offers attachable nodes; pulled off an input and dropped, or an end dragged away, removes it */
export function useLinkDrag(flow: VueFlowStore, offerNodes: (at: { x: number; y: number }, pending: PendingLink) => void) {
  let dragFrom: PendingLink | null = null
  let dragConnected = false

  flow.onConnectStart(({ nodeId, handleId, handleType }) => {
    dragConnected = false
    const socket = nodeId && handleType ? (handleType === 'source' ? findOutputSocket : findInputSocket)(readNodeData(flow, nodeId), handleId) : undefined
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
    // onConnect for the same gesture can land after this hook, so decide next tick
    setTimeout(() => {
      if (dragConnected || !isDroppedOnEmpty(event)) return
      const existing = from.handleType === 'target'
        ? flow.edges.value.filter((e) => e.target === from.nodeId && e.targetHandle === from.handleId)
        : []
      if (existing.length) {
        flow.removeEdges(existing.map((e) => e.id))
        log('Link removed')
        return
      }
      const point = toPoint(event)
      offerNodes({ x: point.clientX, y: point.clientY }, from)
    }, 0)
  })

  let edgeDrag = { updated: false, x: 0, y: 0 }

  flow.onEdgeUpdateStart(({ event }) => {
    const point = toPoint(event)
    edgeDrag = { updated: false, x: point.clientX, y: point.clientY }
  })

  flow.onEdgeUpdate(({ edge, connection }) => {
    if (!canConnect(connection, (id) => readNodeData(flow, id))) return
    edgeDrag.updated = true
    flow.removeEdges([edge.id])
    connectLink(flow, connection)
  })

  flow.onEdgeUpdateEnd(({ edge, event }) => {
    setTimeout(() => {
      if (edgeDrag.updated) return
      const point = toPoint(event)
      // Click on a link end w/o dragging keeps it
      if (Math.hypot(point.clientX - edgeDrag.x, point.clientY - edgeDrag.y) < 4) return
      flow.removeEdges([edge.id])
      log('Link removed')
    }, 0)
  })

  return { isValidConnection: (connection: Connection) => canConnect(connection, (id) => readNodeData(flow, id)) }
}

/** An input holds one link, so an existing one is replaced, as in Blender */
export function connectLink(flow: VueFlowStore, connection: Connection): boolean {
  if (!canConnect(connection, (id) => readNodeData(flow, id))) return false
  const replaced = flow.edges.value.filter((e) => e.target === connection.target && e.targetHandle === connection.targetHandle)
  if (replaced.length) flow.removeEdges(replaced.map((e) => e.id))
  const from = findOutputSocket(readNodeData(flow, connection.source), connection.sourceHandle)!
  flow.addEdges([{
    ...connection,
    id: `e-${connection.source}-${connection.sourceHandle}-${connection.target}-${connection.targetHandle}-${newId()}`,
    style: { stroke: socketColor(from.type), strokeWidth: 2 },
  }])
  return true
}

/** Socket a link is dragged from while its add-node menu is up */
export interface PendingLink {
  nodeId: string
  handleId: string
  handleType: 'source' | 'target'
  type: DataType<any>
}

const readNodeData = (flow: VueFlowStore, id: string) => flow.findNode(id)?.data as GraphNodeData | undefined
const toPoint = (event: MouseEvent | TouchEvent) => ('changedTouches' in event ? event.changedTouches[0] : event)
const isDroppedOnEmpty = (event: MouseEvent | TouchEvent) => !(event.target as Element | null)?.closest('.vue-flow__node, .vue-flow__handle')
