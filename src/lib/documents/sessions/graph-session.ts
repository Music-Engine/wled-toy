import { computed, nextTick, ref, toRaw, watch, type Ref } from 'vue'
import { createDefaultGraph, normalizeDoc, storedDoc, type NodeGraph, type Scene, type StoredEdge, type StoredNode } from '@/lib/graph'
import { cloneJson } from '@/lib/util/json'
import { createCompileSchedule, type GraphCompiler, type GraphTarget, type Timer } from './compile-schedule'
import { createHistory } from '@/lib/documents/history'
import { styleEdges, type LinkEnds, type SocketColor } from '@/lib/documents/edits/links'

/** Graph being edited: compile schedule, autosaved working copy, undo history; editor calls `start`/`stop` as it shows and hides */
export function createGraphSession({ workingCopy, storeEdges, colorOf, target, compiler }: GraphSessionOptions) {
  const initial = normalizeDoc(workingCopy.graph ?? createDefaultGraph())
  const nodes = ref(initial.nodes) as Ref<StoredNode[]>
  const edges = ref(styleEdges(initial, colorOf)) as Ref<StoredEdge[]>
  const scenes = ref(initial.scenes ?? []) as Ref<Scene[]>
  // One serialization per change shared by compile, working copy, undo, dirty check and autosave
  const storedSnapshot = computed(() => storedDoc(nodes.value, storeEdges(), scenes.value))
  const snapshot = () => storedSnapshot.value
  const schedule = createCompileSchedule({ initial, nodes, scenes, storeEdges, snapshot, target, compiler })
  let lastSaved: NodeGraph | null = workingCopy.graph
  let saveTimer: Timer, recordTimer: Timer
  let restoring = false
  let held = false
  const history = createHistory('')

  function flush() {
    clearTimeout(saveTimer)
    saveTimer = undefined
    const doc = snapshot()
    lastSaved = doc
    workingCopy.graph = doc
  }

  function recordNow() {
    clearTimeout(recordTimer)
    recordTimer = undefined
    if (!restoring) history.record(JSON.stringify(snapshot()))
  }

  /** Edit still waiting out its pause becomes its own undo step */
  function commitEdit() {
    if (recordTimer) recordNow()
  }

  function replace(doc: NodeGraph) {
    nodes.value = doc.nodes
    scenes.value = doc.scenes ?? []
    edges.value = styleEdges(doc, colorOf)
  }

  // Vue Flow writes coordinates back into store edges, which link whole nodes, so a deep watch would fire every render;
  // only stored fields are read
  const storedEdgeKey = () =>
    storeEdges()
      .map((e) => [e.id, e.source, e.sourceHandle, e.target, e.targetHandle, (e.style as { stroke?: string } | undefined)?.stroke].join('\u0000'))
      .join('\n')

  // Same, and a Vue Flow node's measurements and handlers make deep traversal the cost of a drag; `data` still deep
  const storedNodeFields = () => nodes.value.map((n) => [n.id, n.type, n.position.x, n.position.y, n.data])

  // Saved in the watcher: Vue batches per tick, and a rAF deferral never runs in a background tab, letting another
  // tab's save overwrite this graph
  watch(
    [storedNodeFields, storedEdgeKey, scenes],
    () => {
      // Drag or scrubbed slider = one step, recorded and saved once changes pause
      clearTimeout(saveTimer)
      saveTimer = setTimeout(flush, 350)
      if (!restoring && !held) {
        clearTimeout(recordTimer)
        recordTimer = setTimeout(recordNow, 350)
      }
      schedule.regenerateSoon()
    },
    { deep: true },
  )

  // Import or another tab's save replaces the graph; own writes ignored
  watch(
    () => workingCopy.graph,
    (graph) => {
      if (!graph || toRaw(graph) === lastSaved) return
      lastSaved = toRaw(graph)
      replace(normalizeDoc(cloneJson(graph)))
    },
  )

  return {
    nodes,
    edges,
    scenes,
    snapshot,
    generated: schedule.generated,
    compileError: schedule.compileError,
    compiledLineNodes: schedule.compiledLineNodes,
    start: schedule.start,
    /** Hidden or gone: working copy written at once, nothing more applied */
    stop() {
      schedule.stop()
      flush()
    },
    flush,
    commitEdit,
    recordNow,
    /** Modal move = one undo step however long it pauses; recorded on release when asked */
    holdHistory() {
      commitEdit()
      held = true
      return async (record: boolean) => {
        // Watcher runs on Vue's deferred queue: an edit just before release must still meet the hold
        await nextTick()
        held = false
        if (record) recordNow()
      }
    },
    /** Current graph = "unedited"; call once Vue Flow's store holds the edges */
    resetHistory: () => history.reset(JSON.stringify(snapshot())),
    /** A change still waiting out its pause is recorded first, so it can be undone too */
    travel(step: 'undo' | 'redo') {
      commitEdit()
      const text = history[step]()
      if (!text) return false
      restoring = true
      replace(normalizeDoc(JSON.parse(text)))
      // Watcher answers this replace next tick; until then nothing is a new edit
      nextTick(() => nextTick(() => (restoring = false)))
      return true
    },
    /** New, Open, Revert, Recover: single acts, so working copy follows at once and history starts clean */
    load(doc: NodeGraph) {
      restoring = true
      replace(doc)
      nextTick(() => {
        flush()
        history.reset(JSON.stringify(snapshot()))
        restoring = false
      })
    },
  }
}

export type GraphEditSession = ReturnType<typeof createGraphSession>

export interface GraphSessionOptions {
  /** Every edit lands here after a pause; other tabs follow it, reload returns to it, a write from elsewhere replaces the graph */
  workingCopy: { graph: NodeGraph | null }
  /** Vue Flow syncs its store to v-model:edges only on count change, so a replaced link never reaches `edges` */
  storeEdges: () => readonly (LinkEnds & { id: string; style?: unknown })[]
  colorOf: SocketColor
  target: GraphTarget
  compiler: GraphCompiler
}
