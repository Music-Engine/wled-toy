<script setup lang="ts">
import { computed, inject, markRaw, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, provide, reactive, ref, shallowRef, toRaw, watch, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import { SelectionMode, VueFlow, useVueFlow, type Connection, type Edge, type GraphNode as FlowNode, type Node } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import GraphDocumentDialogs from '@/components/graph/GraphDocumentDialogs.vue'
import GraphNode from '@/components/graph/GraphNode.vue'
import NodeMenu from '@/components/editor/NodeMenu.vue'
import ParametersPanel from '@/components/graph/ParametersPanel.vue'
import DockContribution from '@/components/shell/DockContribution.vue'
import GlslCode from '@/components/editor/GlslCode.vue'
import CommandScope from '@/components/shell/CommandScope.vue'
import { copyText } from '@/lib/app/clipboard'
import { config } from '@/lib/app/config'
import { createBrowserBackend } from '@/lib/documents/documents'
import { log } from '@/lib/app/logs'
import { useEngine } from '@/lib/engine/engine'
import { categoryById } from '@/lib/shader/glsl'
import { connectedHandlesKey, graphIssuesKey } from '@/components/graph/graph-context'
import { createGraphDocument, graphFileBackendKey, storedDoc, type GraphDocument } from '@/lib/graph/model/document'
import { createHistory } from '@/lib/documents/history'
import { frozenNotice, graphCodeNotice } from '@/lib/shader/shader-export'
import { filterFs, type MenuPreset } from '@/lib/shader/menu-fs'
import { dockHost } from '@/lib/app/workspace'
import { graphImageDrop } from '@/lib/app/file-drop'
import { classifyWheel, type WheelGesture } from './wheel-source'
import {
  GRAPH_FS, GRAPH_NODE_TYPE, canCast, createDefaultGraph, describeNodeItem, firstCompatibleSocket, generateGlsl, inputSocket, itemFor,
  newNodeData, normalizeDoc, outputSocket, pruneScenes, rateOf, shapeOf,
  type GraphDoc, type GraphIssue, type GraphNodeData, type LinkType, type NodeItem, type StoredEdge,
} from '@/lib/graph'

interface PendingLink {
  nodeId: string
  handleId: string
  handleType: 'source' | 'target'
  type: LinkType
}

const FLOW_ID = 'wledtoy-graph'
const NODE_WIDTH = 240
const engine = useEngine()
const router = useRouter()
const nodeTypes = { [GRAPH_NODE_TYPE]: markRaw(GraphNode) }

const initial = normalizeDoc(config.graph ?? createDefaultGraph())

// Vue Flow's element types are too deep for UnwrapRef, so the refs are typed directly
const nodes = ref(initial.nodes) as unknown as Ref<Node<GraphNodeData>[]>
const edges = ref(styledEdges(initial)) as unknown as Ref<Edge[]>
const scenes = ref(initial.scenes ?? [])

const {
  onConnect, onConnectStart, onConnectEnd, onEdgeUpdateStart, onEdgeUpdate, onEdgeUpdateEnd,
  addEdges, removeEdges, addNodes, screenToFlowCoordinate, findNode, fitView, edges: storeEdges, getNodes,
  getSelectedNodes, getSelectedEdges, removeNodes, addSelectedNodes, addSelectedElements, removeSelectedElements,
  onSelectionStart, onSelectionEnd, onNodesChange, nodesSelectionActive, viewport, setViewport, panBy, minZoom, maxZoom,
} = useVueFlow(FLOW_ID)

const flowEl = ref<HTMLElement>()
const active = ref(false)
const codeOpen = ref(true)
const pointerInFlow = ref(false)
const nodeMenu = reactive({ open: false, position: null as { x: number; y: number } | null, pending: null as PendingLink | null })
const pointer = { x: 0, y: 0 }
const generated = shallowRef(generateGlsl(initial))
const compileError = ref<string | null>(null)
const compiledLineNodes = shallowRef<(string | null)[]>([])
let lastSaved: GraphDoc | null = config.graph
let lastCompiled = ''
let regenTimer: ReturnType<typeof setTimeout> | undefined
let liveTimer: ReturnType<typeof setTimeout> | undefined

// Graph data is plain JSON. structuredClone rejects the reactive proxies Vue leaves nested
// inside it (toRaw only unwraps the outer object), e.g. color ramp stops after an edit.
const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value))

// Vue Flow only syncs its store back to v-model:edges when the edge count changes, so a
// replaced link (remove + add in one tick) never reaches the `edges` ref. Read the store.
// A computed, so the compile, the working copy, the undo recorder, the dirty check and the autosave all read one
// serialization per change instead of taking their own.
const storedSnapshot = computed(() => storedDoc(nodes.value, storeEdges.value, scenes.value))
const snapshot = () => storedSnapshot.value

/**
 * Knob turns, scene fades and MIDI change the CPU plan but not the shader, so they apply at once. A change to the
 * shader waits for the edits to pause (`compileNow`), and its plan waits with it: the two index the same uniform slots.
 */
function regenerate(compileNow = true) {
  const doc = snapshot()
  // deleting a knob takes its values out of every scene; assigning only on a real change keeps this from re-triggering itself
  const pruned = pruneScenes(scenes.value, doc.nodes)
  if (JSON.stringify(pruned) !== JSON.stringify(scenes.value)) scenes.value = pruned
  generated.value = generateGlsl(doc)
  const { code, control, output, error, lineNodes } = generated.value
  if (!active.value || error) return
  if (code !== lastCompiled && !compileNow) {
    clearTimeout(regenTimer)
    regenTimer = setTimeout(regenerate, 250)
    return
  }
  engine.setControlPlan(control)
  engine.setOutput(output)
  if (code === lastCompiled) return
  const ok = engine.compile(code, 'graph')
  compileError.value = ok ? null : engine.compileError.value
  compiledLineNodes.value = lineNodes
  lastCompiled = code
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

function saveGraph() {
  clearTimeout(saveTimer)
  saveTimer = undefined
  const doc = snapshot()
  lastSaved = doc
  config.graph = doc
}

const flushSave = saveGraph

// Save in the watcher itself: Vue already batches changes per tick, and a requestAnimationFrame
// deferral never runs in a background tab, letting another tab's save overwrite this graph.
const history = createHistory('')
let restoring = false
let recordTimer: ReturnType<typeof setTimeout> | undefined

function recordNow() {
  clearTimeout(recordTimer)
  recordTimer = undefined
  if (!restoring) history.record(JSON.stringify(snapshot()))
}

/** Steps the graph back or forward. A change still waiting out its pause is recorded first, so it can be undone too. */
function travel(step: 'undo' | 'redo') {
  if (recordTimer) recordNow()
  const text = history[step]()
  if (!text) return false
  restoring = true
  replaceGraph(normalizeDoc(JSON.parse(text)))
  // the watcher below answers this replace on the next tick; until it has, nothing is a new edit
  nextTick(() => nextTick(() => (restoring = false)))
  return true
}

// Vue Flow's edge renderer writes sourceX/sourceY/targetX/targetY back into the store edge it is drawing, and a store
// edge also links back to its two whole nodes. Deep-watching the store edges therefore makes every edge render
// re-trigger the watcher below, which is what Vue aborts as a recursive update. This reads what the document keeps.
const storedEdgeKey = () => storeEdges.value
  .map((e) => [e.id, e.source, e.sourceHandle, e.target, e.targetHandle, (e.style as { stroke?: string } | undefined)?.stroke].join('\u0000'))
  .join('\n')

// Same reason, and the deep traversal is the cost of a drag: a Vue Flow node also carries measured dimensions, handle
// rectangles, a computed position and its event handlers. Only the stored fields are watched; `data` still deeply.
const storedNodeFields = () => nodes.value.map((n) => [n.id, n.type, n.position.x, n.position.y, n.data])

watch([storedNodeFields, storedEdgeKey, scenes], () => {
  // a drag or a scrubbed slider is one step: it is recorded once the changes pause, and the working copy that other
  // tabs and a reload read is written on the same pause. A closing window flushes it (`flushSave`) rather than waiting.
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveGraph, 350)
  if (!restoring) {
    clearTimeout(recordTimer)
    recordTimer = setTimeout(recordNow, 350)
  }
  // one pass per frame at most: dragging a node fires this on every mouse move
  liveTimer ??= setTimeout(() => {
    liveTimer = undefined
    regenerate(false)
  }, 16)
}, { deep: true })

window.addEventListener('pagehide', flushSave)

function replaceGraph(doc: GraphDoc) {
  nodes.value = doc.nodes
  scenes.value = doc.scenes ?? []
  edges.value = styledEdges(doc)
}

/** A hand-written file has no edge styles; the editor colors a link by its source socket when it is drawn. */
function styledEdges(doc: GraphDoc): Edge[] {
  const byId = new Map(doc.nodes.map((n) => [n.id, n.data]))
  return doc.edges.map((e) => {
    const from = e.style?.stroke ? undefined : outputSocket(byId.get(e.source), e.sourceHandle)
    return from ? { ...e, style: { stroke: from.type.color, strokeWidth: 2 } } : e
  }) as Edge[]
}

// an import or another tab's save replaces the graph; ignore our own writes to config.graph
watch(() => config.graph, (graph) => {
  if (!graph || toRaw(graph) === lastSaved) return
  lastSaved = toRaw(graph)
  replaceGraph(normalizeDoc(cloneJson(graph)))
})

// The file is what Save wrote last; config.graph stays the working copy that every edit lands in, that other tabs follow
// and that a reload comes back to. A loaded file replaces the graph like another tab's save does, and the watcher above
// then writes it into the working copy.
const graphDocument = shallowRef<GraphDocument>()
const fileBackend = inject(graphFileBackendKey, createBrowserBackend, true)

// after mount, because the first snapshot is what "unedited" means and Vue Flow's store has no edges before that
onMounted(() => {
  // passive: false so the canvas can take the scroll; events it does not handle are left alone
  flowEl.value!.addEventListener('wheel', onWheel, { passive: false })
  graphDocument.value = createGraphDocument({
    backend: fileBackend,
    getSnapshot: snapshot,
    onLoad(doc) {
      restoring = true
      replaceGraph(doc)
      nextTick(() => {
        fitView({ padding: 0.2 })
        // New, Open, Revert and Recover are single acts, not gestures: the working copy follows them at once
        flushSave()
        // another document starts with a clean history, as the first one does
        history.reset(JSON.stringify(snapshot()))
        restoring = false
      })
    },
  })
  history.reset(JSON.stringify(snapshot()))
  graphImageDrop.value = addImageTexture
})

const compileIssues = computed<GraphIssue[]>(() => {
  const error = compileError.value
  if (!error) return []
  const found = [...error.matchAll(/ERROR:\s*\d+:(\d+):\s*(.*)/g)].map((m) => ({
    nodeId: compiledLineNodes.value[Number(m[1])] ?? null,
    message: `GLSL: ${m[2].trim()}`,
  }))
  return found.length ? found : [{ nodeId: null, message: `GLSL: ${error.trim().split('\n')[0]}` }]
})

const problems = computed<GraphIssue[]>(() => [
  ...(graphDocument.value?.error.value ? [{ nodeId: null, message: graphDocument.value.error.value }] : []),
  ...(generated.value.error ? [{ nodeId: generated.value.errorNode, message: generated.value.error }] : []),
  ...generated.value.issues,
  ...compileIssues.value,
])

const nodeIssues = computed(() => {
  const map = new Map<string, string[]>()
  for (const { nodeId, message } of problems.value) {
    if (nodeId) map.set(nodeId, [...(map.get(nodeId) ?? []), message])
  }
  return map
})
provide(graphIssuesKey, nodeIssues)

let handlesByNode = new Map<string, ReadonlySet<string>>()
const connectedHandles = computed(() => {
  const next = new Map<string, Set<string>>()
  for (const edge of storeEdges.value) {
    if (!edge.targetHandle) continue
    const set = next.get(edge.target)
    if (set) set.add(edge.targetHandle)
    else next.set(edge.target, new Set([edge.targetHandle]))
  }
  const kept = new Map<string, ReadonlySet<string>>()
  for (const [id, set] of next) {
    const before = handlesByNode.get(id)
    // handing back the same set keeps a node whose links did not change from re-rendering
    kept.set(id, before && before.size === set.size && [...set].every((handle) => before.has(handle)) ? before : set)
  }
  handlesByNode = kept
  return kept
})
provide(connectedHandlesKey, connectedHandles)

const dataOf = (id: string) => findNode(id)?.data as GraphNodeData | undefined

function isValidConnection(c: Connection) {
  if (c.source === c.target) return false
  const from = outputSocket(dataOf(c.source), c.sourceHandle)
  const to = inputSocket(dataOf(c.target), c.targetHandle)
  // a control-rate node computes once per frame, so nothing that exists only per pixel can feed it
  const perPixelIntoControl = rateOf(shapeOf(dataOf(c.source))!) === 'pixel' && rateOf(shapeOf(dataOf(c.target))!) === 'control'
  return !!from && !!to && canCast(from.type, to.type) && !perPixelIntoControl
}

/** Adds a link; an input holds one link, so an existing one is replaced like in Blender. */
function connectLink(c: Connection): boolean {
  if (!isValidConnection(c)) return false
  const replaced = storeEdges.value.filter((e) => e.target === c.target && e.targetHandle === c.targetHandle)
  if (replaced.length) removeEdges(replaced.map((e) => e.id))
  const from = outputSocket(dataOf(c.source), c.sourceHandle)!
  addEdges([{
    ...c,
    id: `e-${c.source}-${c.sourceHandle}-${c.target}-${c.targetHandle}-${Date.now().toString(36)}`,
    style: { stroke: from.type.color, strokeWidth: 2 },
  }])
  return true
}

const pointOf = (event: MouseEvent | TouchEvent) => ('changedTouches' in event ? event.changedTouches[0] : event)
const droppedOnEmpty = (event: MouseEvent | TouchEvent) => !(event.target as Element | null)?.closest('.vue-flow__node, .vue-flow__handle')

let dragFrom: PendingLink | null = null
let dragConnected = false

onConnectStart(({ nodeId, handleId, handleType }) => {
  dragConnected = false
  const socket = nodeId && handleType ? (handleType === 'source' ? outputSocket : inputSocket)(dataOf(nodeId), handleId) : undefined
  const type = socket?.type
  dragFrom = nodeId && handleId && handleType && type ? { nodeId, handleId, handleType, type } : null
})

onConnect((c) => {
  dragConnected = true
  connectLink(c)
})

onConnectEnd((event) => {
  const from = dragFrom
  dragFrom = null
  if (!from || !event) return
  // onConnect for the same gesture can land after this hook, so decide on the next tick
  setTimeout(() => {
    if (dragConnected || !droppedOnEmpty(event)) return
    // Blender: pulling a link off a connected input and dropping it on nothing removes it
    const existing = from.handleType === 'target'
      ? storeEdges.value.filter((e) => e.target === from.nodeId && e.targetHandle === from.handleId)
      : []
    if (existing.length) {
      removeEdges(existing.map((e) => e.id))
      log('Link removed')
      return
    }
    const point = pointOf(event)
    nodeMenu.pending = from
    nodeMenu.position = { x: point.clientX, y: point.clientY }
    nodeMenu.open = true
  }, 0)
})

let edgeDrag = { updated: false, x: 0, y: 0 }

onEdgeUpdateStart(({ event }) => {
  const point = pointOf(event)
  edgeDrag = { updated: false, x: point.clientX, y: point.clientY }
})

onEdgeUpdate(({ edge, connection }) => {
  if (!isValidConnection(connection)) return
  edgeDrag.updated = true
  removeEdges([edge.id])
  connectLink(connection)
})

onEdgeUpdateEnd(({ edge, event }) => {
  setTimeout(() => {
    if (edgeDrag.updated) return
    const point = pointOf(event)
    // a click on the link end without dragging should not delete it
    if (Math.hypot(point.clientX - edgeDrag.x, point.clientY - edgeDrag.y) < 4) return
    removeEdges([edge.id])
    log('Link removed')
  }, 0)
})

// dragging a link into empty space offers only the nodes that link can attach to
const menuFs = computed(() => {
  const pending = nodeMenu.pending
  if (!pending) return GRAPH_FS
  const need = pending.handleType === 'source' ? 'in' : 'out'
  return filterFs(GRAPH_FS, (item) => !!firstCompatibleSocket(item.base, pending.type, need))
})

watch(() => nodeMenu.open, (open) => {
  if (!open) nodeMenu.pending = null
})

/** Opens the add-node menu at a screen point, or centered as a search palette when there is none. */
function openMenu(at: { x: number; y: number } | null) {
  nodeMenu.pending = null
  nodeMenu.position = at
  nodeMenu.open = true
}

function onPaneContextMenu(e: MouseEvent) {
  e.preventDefault()
  openMenu({ x: e.clientX, y: e.clientY })
}

function addNode(item: NodeItem, preset?: MenuPreset, screenPoint = nodeMenu.position) {
  const rect = flowEl.value?.getBoundingClientRect()
  const at = screenPoint ?? (rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: 0, y: 0 })
  const pending = nodeMenu.pending
  const position = screenToFlowCoordinate(at)
  // a node feeding the dragged input goes to its left so the link reads left to right
  if (pending?.handleType === 'target') position.x -= NODE_WIDTH
  const id = `${item.id}-${Date.now().toString(36)}`
  addNodes([{ id, type: GRAPH_NODE_TYPE, position, data: newNodeData(item.id, preset?.values as GraphNodeData['values']) }])
  log(`Added graph node: ${preset ? `${item.title} (${preset.title})` : item.title}`)

  const socket = pending && firstCompatibleSocket(item.base, pending.type, pending.handleType === 'source' ? 'in' : 'out')
  if (pending && socket) {
    nextTick(() => connectLink(pending.handleType === 'source'
      ? { source: pending.nodeId, sourceHandle: pending.handleId, target: id, targetHandle: socket.name }
      : { source: id, sourceHandle: socket.name, target: pending.nodeId, targetHandle: pending.handleId }))
  }
  return id
}

/** A dropped image becomes a selected Image Texture node under the drop, and one undo step of its own. */
function addImageTexture(imageId: string, title: string, at: { x: number; y: number }) {
  // an edit still waiting out its pause would otherwise be undone together with the new node
  if (recordTimer) recordNow()
  const rect = flowEl.value!.getBoundingClientRect()
  const onCanvas = at.x >= rect.left && at.x <= rect.right && at.y >= rect.top && at.y <= rect.bottom
  const id = addNode(itemFor('imageTexture')!, { title, values: { filename: imageId } }, onCanvas ? at : null)
  nextTick(() => {
    removeSelectedElements()
    const node = findNode(id)
    if (node) addSelectedNodes([node])
    recordNow()
  })
}

function focusNode(id: string) {
  fitView({ nodes: [id], padding: 1.5, maxZoom: 1.2, duration: 300 })
}

/** Selects exactly these nodes and, as a box selection does, every link that touches one of them. */
function selectNodes(ids: Set<string>) {
  addSelectedElements([
    ...getNodes.value.filter((n) => ids.has(n.id)),
    ...storeEdges.value.filter((e) => ids.has(e.source) || ids.has(e.target)),
  ])
}

// Vue Flow clears the selection when a box starts and again whenever the box touches a different set of nodes,
// so a Shift+drag notes what was selected before the pane sees the press and puts it back
let keptSelection = new Set<string>()
let boxSelecting = false

function noteSelection(e: PointerEvent) {
  keptSelection = new Set(e.shiftKey && e.button === 0 ? getSelectedNodes.value.map((n) => n.id) : [])
}

function restoreKept() {
  for (const id of keptSelection) {
    const node = findNode(id)
    if (node) node.selected = true
  }
}

onSelectionStart(() => {
  boxSelecting = true
  restoreKept()
})

onNodesChange((changes) => {
  if (boxSelecting && changes.some((change) => change.type === 'select' && !change.selected && keptSelection.has(change.id))) nextTick(restoreKept)
})

onSelectionEnd(() => {
  boxSelecting = false
  // the box Vue Flow leaves around the selected nodes covers their fields until the next click
  nodesSelectionActive.value = false
  if (keptSelection.size) selectNodes(new Set([...keptSelection, ...getSelectedNodes.value.map((n) => n.id)]))
  keptSelection = new Set()
})

function zoomAround(point: { clientX: number; clientY: number }, zoom: number) {
  const rect = flowEl.value!.getBoundingClientRect()
  const from = viewport.value
  const next = Math.min(maxZoom.value, Math.max(minZoom.value, zoom))
  const x = point.clientX - rect.left
  const y = point.clientY - rect.top
  setViewport({ x: x - ((x - from.x) * next) / from.zoom, y: y - ((y - from.y) * next) / from.zoom, zoom: next })
}

let wheelGesture: WheelGesture | null = null

// Vue Flow either zooms or pans on every wheel event; a mouse wheel should zoom and a trackpad should pan, so its scroll handling is off
function onWheel(e: WheelEvent) {
  const target = e.target as Element
  if (!target.closest('.vue-flow__viewport') || target.closest('.nowheel')) return
  e.preventDefault()
  wheelGesture = classifyWheel(e as WheelEvent & { wheelDeltaY?: number }, wheelGesture)
  if (wheelGesture.source === 'wheel') zoomAround(e, viewport.value.zoom * 1.2 ** -Math.sign(e.deltaY))
  // a pinch arrives as a wheel event with ctrlKey set
  else if (e.ctrlKey || e.metaKey) zoomAround(e, viewport.value.zoom * 2 ** (-Math.max(-25, Math.min(25, e.deltaY)) * 0.02))
  else panBy({ x: -e.deltaX, y: -e.deltaY })
}

// Blender's Ctrl+MMB: drag right or up to zoom in, around the point where the drag began
function onZoomDragStart(e: MouseEvent) {
  if (e.button !== 1 || !e.ctrlKey) return
  // Vue Flow pans on any middle press over a node, Ctrl or not
  e.preventDefault()
  e.stopPropagation()
  const startZoom = viewport.value.zoom
  const move = (at: MouseEvent) => zoomAround(e, startZoom * 2 ** ((at.clientX - e.clientX - (at.clientY - e.clientY)) / 200))
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', () => window.removeEventListener('mousemove', move), { once: true })
}

function trackPointer(e: PointerEvent) {
  pointer.x = e.clientX
  pointer.y = e.clientY
  pointerInFlow.value = true
}

let clipboard: { nodes: { id: string; position: { x: number; y: number }; data: GraphNodeData }[]; edges: StoredEdge[] } | null = null

function copySelection(): boolean {
  const selected = getSelectedNodes.value
  if (!selected.length) return false
  const ids = new Set(selected.map((n) => n.id))
  clipboard = {
    nodes: selected.map((n) => ({ id: n.id, position: { ...n.position }, data: cloneJson(n.data) as GraphNodeData })),
    // only links inside the selection travel with it, like in Blender
    edges: snapshot().edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
  }
  log(`Copied ${selected.length} node${selected.length > 1 ? 's' : ''}`)
  return true
}

function deleteSelection() {
  removeEdges(getSelectedEdges.value)
  removeNodes(getSelectedNodes.value)
}

function pasteClipboard(): boolean {
  if (!clipboard) return false
  const stamp = Date.now().toString(36)
  const ids = new Map(clipboard.nodes.map((n, i) => [n.id, `${n.data.kind}-${stamp}-${i}`]))
  const xs = clipboard.nodes.map((n) => n.position.x)
  const ys = clipboard.nodes.map((n) => n.position.y)
  // under the pointer when it is over the canvas, otherwise next to the originals
  const target = pointerInFlow.value ? screenToFlowCoordinate(pointer) : null
  const shift = target
    ? { x: target.x - NODE_WIDTH / 2 - (Math.min(...xs) + Math.max(...xs)) / 2, y: target.y - (Math.min(...ys) + Math.max(...ys)) / 2 }
    : { x: 40, y: 40 }
  addNodes(clipboard.nodes.map((n) => ({
    id: ids.get(n.id)!,
    type: GRAPH_NODE_TYPE,
    position: { x: n.position.x + shift.x, y: n.position.y + shift.y },
    data: cloneJson(n.data),
  })))
  const edges = clipboard.edges
  nextTick(() => {
    addEdges(edges.map((e, i) => ({ ...e, id: `e-${stamp}-${i}`, source: ids.get(e.source)!, target: ids.get(e.target)! })))
    addSelectedNodes([...ids.values()].map((id) => findNode(id)!).filter(Boolean))
  })
  log(`Pasted ${clipboard.nodes.length} node${clipboard.nodes.length > 1 ? 's' : ''}`)
  return true
}

// text the user selected elsewhere on the page keeps the browser's own copy
const ownsClipboard = (e: Event) => !!(e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]') || !!window.getSelection()?.toString()

function clipboardAction(action: 'copy' | 'cut' | 'paste'): boolean {
  if (action === 'paste') return pasteClipboard()
  if (!copySelection()) return false
  if (action === 'cut') deleteSelection()
  return true
}

function onClipboardKey(e: KeyboardEvent): boolean {
  const key = e.key.toLowerCase()
  const command = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey
  const bare = !e.metaKey && !e.ctrlKey && !e.altKey
  if (!(command && 'cxv'.includes(key)) && !(bare && key === 'x')) return false
  if (ownsClipboard(e)) return false
  if (!bare) return clipboardAction(key === 'c' ? 'copy' : key === 'x' ? 'cut' : 'paste')
  deleteSelection()
  return true
}

let clipboardKeyAt = -Infinity

// Under a native Edit menu Cmd+C, Cmd+X and Cmd+V never arrive as keys: the menu item takes them and the page gets the clipboard event.
// A key handled here cancels its clipboard event; should one arrive all the same, it must not run the action a second time.
function onClipboardEvent(e: ClipboardEvent) {
  if (nodeMenu.open || performance.now() - clipboardKeyAt < 100 || ownsClipboard(e)) return
  if (clipboardAction(e.type as 'copy' | 'cut' | 'paste')) e.preventDefault()
}

function selectAll() {
  selectNodes(new Set(getNodes.value.map((n) => n.id)))
}

function onKeydown(e: KeyboardEvent) {
  if (nodeMenu.open || document.querySelector('[role="dialog"]')) return
  if (onClipboardKey(e)) {
    e.preventDefault()
    clipboardKeyAt = performance.now()
    return
  }
  const command = e.metaKey || e.ctrlKey
  const search = e.key === ' ' && !e.shiftKey && !command && !e.altKey
  // with Alt held macOS reports the key as a letter of its own
  const letterA = e.key.toLowerCase() === 'a' || (e.altKey && e.code === 'KeyA')
  const add = letterA && e.shiftKey && !command && !e.altKey
  const all = letterA && command && !e.shiftKey && !e.altKey
  const none = (e.key === 'Escape' || (letterA && e.altKey && !e.shiftKey)) && !command
  const letterZ = e.key.toLowerCase() === 'z' && command && !e.altKey
  const step = letterZ ? (e.shiftKey ? 'redo' : 'undo') : e.key.toLowerCase() === 'y' && e.ctrlKey && !e.shiftKey && !e.altKey ? 'redo' : null
  if (!search && !add && !all && !none && !step) return
  // Space on a focused button is that button's click
  if ((e.target as HTMLElement | null)?.closest(`input, textarea, select, [contenteditable="true"]${search ? ', button' : ''}`)) return
  e.preventDefault()
  if (step) travel(step)
  else if (all) selectAll()
  else if (none) removeSelectedElements()
  else openMenu(add && pointerInFlow.value ? { ...pointer } : null)
}

// shader mode and a pasted shader have no control plan feeding iControl, so the knob values are written into the code
function standaloneGlsl() {
  const generated = generateGlsl(snapshot(), { standalone: true, controls: (nodeId, output) => engine.controlOutput(nodeId, output) })
  const notice = frozenNotice(generated.frozen)
  if (notice) log(notice, 'warn')
  return { code: generated.code, notice }
}

function sendToShader() {
  const { code, notice } = standaloneGlsl()
  config.code = code
  graphCodeNotice.value = notice
  log('Graph code sent to shader mode; Cmd+Z in the editor restores the previous shader')
  router.push('/')
}

function copyGlsl() {
  return copyText(standaloneGlsl().code)
}

const minimapColor = (node: FlowNode) => {
  const kind = (node.data as GraphNodeData | undefined)?.kind ?? ''
  const category = itemFor(kind)?.category
  return (category && categoryById.get(category)?.color) || '#555'
}

onActivated(() => {
  active.value = true
  lastCompiled = ''
  regenerate()
  window.addEventListener('keydown', onKeydown)
  for (const type of ['copy', 'cut', 'paste'] as const) window.addEventListener(type, onClipboardEvent)
})

function removeKeyListeners() {
  window.removeEventListener('keydown', onKeydown)
  for (const type of ['copy', 'cut', 'paste'] as const) window.removeEventListener(type, onClipboardEvent)
}

onDeactivated(() => {
  active.value = false
  flushSave()
  clearTimeout(regenTimer)
  clearTimeout(liveTimer)
  liveTimer = undefined
  removeKeyListeners()
})

onBeforeUnmount(() => {
  flushSave()
  clearTimeout(regenTimer)
  clearTimeout(liveTimer)
  liveTimer = undefined
  removeKeyListeners()
  window.removeEventListener('pagehide', flushSave)
  if (graphImageDrop.value === addImageTexture) graphImageDrop.value = null
})
</script>

<template>
  <div class="h-full min-h-0">
    <section class="flex h-full min-h-0 flex-col">
      <div class="flex h-(--app-header-h) shrink-0 items-center gap-1 overflow-hidden border-b border-(--app-hairline) bg-(--app-chrome) px-2">
        <UTooltip text="Add node" :kbds="['shift', 'a']">
          <UButton label="Add node" size="xs" @click="openMenu(null)" />
        </UTooltip>
        <UButton color="neutral" variant="ghost" label="Fit view" size="xs" @click="fitView({ padding: 0.2, duration: 300 })" />
        <UButton color="neutral" variant="ghost" label="Send to shader mode" size="xs" @click="sendToShader" />
      </div>

      <div
        ref="flowEl"
        class="relative min-h-0 flex-1"
        @pointermove="trackPointer"
        @pointerleave="pointerInFlow = false"
        @pointerdown.capture="noteSelection"
        @mousedown.capture="onZoomDragStart"
      >
        <VueFlow
          :id="FLOW_ID"
          v-model:nodes="nodes"
          v-model:edges="edges"
          :node-types="nodeTypes"
          :is-valid-connection="isValidConnection"
          :delete-key-code="['Backspace', 'Delete']"
          :selection-key-code="true"
          :pan-on-drag="[1]"
          :selection-mode="SelectionMode.Partial"
          multi-selection-key-code="Shift"
          :pan-activation-key-code="null"
          :zoom-activation-key-code="null"
          :zoom-on-scroll="false"
          :zoom-on-pinch="false"
          :min-zoom="0.2"
          :max-zoom="2"
          edges-updatable
          fit-view-on-init
          @pane-context-menu="onPaneContextMenu"
          class="h-full"
        >
          <Background :gap="20" :size="1.3" pattern-color="#6b6b6b" />
          <Controls position="bottom-left" />
          <MiniMap position="bottom-right" pannable zoomable :node-color="minimapColor" mask-color="rgb(0 0 0 / 0.45)" />
        </VueFlow>
      </div>
      <ProblemStrip :problems="problems" @reveal="focusNode" />
    </section>

    <DockContribution tab="parameters">
      <ParametersPanel v-model:scenes="scenes" :flow-id="FLOW_ID" />
    </DockContribution>
    <DockContribution tab="problems">
      <ProblemsList :problems="problems" @reveal="focusNode" />
    </DockContribution>
    <DockContribution tab="glsl">
      <GlslCode :code="generated.code" class="block px-2.5 py-2 text-[12.5px] leading-relaxed" />
    </DockContribution>
    <Teleport :to="dockHost('glsl', 'actions')">
      <button type="button" class="app-button" @click="copyGlsl">Copy</button>
      <button type="button" class="app-button ms-1" @click="sendToShader">Send to Shader Mode</button>
    </Teleport>

    <NodeMenu v-model:open="nodeMenu.open" :position="nodeMenu.position" :fs="menuFs" :describe="describeNodeItem" @select="addNode" />
    <GraphDocumentDialogs v-if="graphDocument" :document="graphDocument" />
    <CommandScope
      :handlers="{
        'graph.addNode': () => openMenu(null),
        'graph.searchNodes': () => openMenu(null),
        'graph.fitView': () => fitView({ padding: 0.2, duration: 300 }),
        'graph.sendToShader': sendToShader,
        'graph.copyGlsl': copyGlsl,
        'graph.copy': copySelection,
        'graph.cut': () => copySelection() && deleteSelection(),
        'graph.paste': pasteClipboard,
        'graph.delete': deleteSelection,
        'graph.selectAll': selectAll,
        'graph.undo': () => travel('undo'),
        'graph.redo': () => travel('redo'),
        'file.new': () => graphDocument?.newGraph(),
        'file.open': () => graphDocument?.open(),
        'file.save': () => graphDocument?.save(),
        'file.saveAs': () => graphDocument?.saveAs(),
        'file.revert': () => graphDocument?.revert(),
      }"
    />
  </div>
</template>
