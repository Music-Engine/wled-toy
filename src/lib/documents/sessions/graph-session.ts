import { computed, nextTick, ref, shallowRef, toRaw, watch, type Ref } from 'vue'
import { createDefaultGraph, normalizeDoc, pruneScenes, storedDoc, type CompileResult, type GlslProgram, type NodeGraph, type ProgramUniform, type Scene, type SlotTable, type StoredEdge, type StoredNode } from '@/lib/graph'
import { cloneJson } from '@/lib/util/json'
import { clamp } from '@/lib/util/math'
import { compileKey } from './compile-key'
import { createHistory } from '@/lib/documents/history'
import { styledEdges, type LinkEnds, type SocketColor } from '@/lib/documents/edits/links'

/**
 * The graph being edited: its compile schedule, the working copy it autosaves to, and its undo history. The editor binds
 * `nodes`, `edges` and `scenes` to the canvas and calls `start` and `stop` as it is shown and hidden.
 */
export function createGraphSession({ workingCopy, storeEdges, colorOf, target, compiler }: GraphSessionOptions) {
  const initial = normalizeDoc(workingCopy.graph ?? createDefaultGraph())
  const nodes = ref(initial.nodes) as Ref<StoredNode[]>
  const edges = ref(styledEdges(initial, colorOf)) as Ref<StoredEdge[]>
  const scenes = ref(initial.scenes ?? []) as Ref<Scene[]>

  const generated = shallowRef(compiler.compile(initial, { slots: target.readSlots() }))
  const compileError = ref<string | null>(null)
  // what the program the target last took emitted on each line, for tracing its GLSL errors to nodes
  const compiledLineNodes = shallowRef<GlslProgram['lineNodes']>({ pixel: [], frame: [] })
  let active = false
  let lastSaved: NodeGraph | null = workingCopy.graph
  let lastCompiled = ''
  let running: GlslProgram | null = null
  // the compile key `generated` was built from and the one the target last took
  let generatedKey = ''
  let appliedKey = ''
  let prunedScenes: Scene[] | null = null
  let regenTimer: Timer, liveTimer: Timer, saveTimer: Timer, recordTimer: Timer
  let restoring = false
  let held = false
  const history = createHistory('')

  // A computed, so the compile, the working copy, the undo recorder, the dirty check and the autosave all read one
  // serialization per change instead of taking their own.
  const storedSnapshot = computed(() => storedDoc(nodes.value, storeEdges(), scenes.value))
  const snapshot = () => storedSnapshot.value

  /**
   * Knob turns, scene fades and MIDI bindings write a uniform and never compile, so they apply at once. A program whose
   * shaders changed waits for the edits to pause (`compileNow`); one that only changed what the host reads loads at once.
   */
  function regenerate(compileNow = true) {
    const key = compileKey(nodes.value, storeEdges())
    if (key !== generatedKey || scenes.value !== prunedScenes) pruneStaleScenes()
    if (key !== generatedKey) {
      generatedKey = key
      generated.value = compiler.compile(snapshot(), { slots: target.readSlots() })
    }
    if (!active) return
    const { program, slots } = generated.value
    const code = program && `${program.frame?.code ?? ''}\n${program.pixel}`
    if (program && key !== appliedKey) {
      if (code !== lastCompiled && !compileNow) {
        clearTimeout(regenTimer)
        regenTimer = setTimeout(regenerate, 250)
      } else {
        compileError.value = target.load(program, slots)
        compiledLineNodes.value = program.lineNodes
        if (!compileError.value) running = program
        appliedKey = key
        lastCompiled = code!
      }
    }
    writeKnobUniforms()
  }

  /** Every knob's value from its node into the running program, clamped as the Knob node does. */
  function writeKnobUniforms() {
    for (const uniform of running?.uniforms ?? []) {
      if (uniform.kind !== 'knob') continue
      const value = nodes.value.find((n) => n.id === uniform.node)?.data.values.value
      if (typeof value === 'number') target.set(uniform, clamp(value, Math.min(uniform.min, uniform.max), Math.max(uniform.min, uniform.max)))
    }
  }

  /** Deleting a knob takes its values out of every scene. */
  function pruneStaleScenes() {
    const pruned = pruneScenes(scenes.value, nodes.value)
    // pruning only drops values, so a scene that kept its count is unchanged; assigning only then keeps this from re-triggering itself
    if (pruned.some((scene, i) => Object.keys(scene.values).length !== Object.keys(scenes.value[i].values).length)) scenes.value = pruned
    prunedScenes = scenes.value
  }

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

  /** An edit still waiting out its pause becomes its own undo step, so what follows is not undone together with it. */
  function commitEdit() {
    if (recordTimer) recordNow()
  }

  function replace(doc: NodeGraph) {
    nodes.value = doc.nodes
    scenes.value = doc.scenes ?? []
    edges.value = styledEdges(doc, colorOf)
  }

  // Vue Flow's edge renderer writes its coordinates back into the store edge it draws, and a store edge links to its two
  // whole nodes, so deep-watching store edges re-triggers the watcher below on every render. This reads what the document keeps.
  const storedEdgeKey = () => storeEdges()
    .map((e) => [e.id, e.source, e.sourceHandle, e.target, e.targetHandle, (e.style as { stroke?: string } | undefined)?.stroke].join('\u0000'))
    .join('\n')

  // Same reason, and the deep traversal is the cost of a drag: a Vue Flow node also carries measured dimensions, handle
  // rectangles, a computed position and its event handlers. Only the stored fields are watched; `data` still deeply.
  const storedNodeFields = () => nodes.value.map((n) => [n.id, n.type, n.position.x, n.position.y, n.data])

  // Save in the watcher itself: Vue already batches changes per tick, and a requestAnimationFrame deferral never runs in
  // a background tab, letting another tab's save overwrite this graph.
  watch([storedNodeFields, storedEdgeKey, scenes], () => {
    // a drag or a scrubbed slider is one step, recorded and written to the working copy once the changes pause
    clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, 350)
    if (!restoring && !held) {
      clearTimeout(recordTimer)
      recordTimer = setTimeout(recordNow, 350)
    }
    // one pass per frame at most: dragging a node fires this on every mouse move
    liveTimer ??= setTimeout(() => {
      liveTimer = undefined
      regenerate(false)
    }, 16)
  }, { deep: true })

  // an import or another tab's save replaces the graph; our own writes are ignored
  watch(() => workingCopy.graph, (graph) => {
    if (!graph || toRaw(graph) === lastSaved) return
    lastSaved = toRaw(graph)
    replace(normalizeDoc(cloneJson(graph)))
  })

  return {
    nodes,
    edges,
    scenes,
    snapshot,
    generated,
    compileError,
    compiledLineNodes,
    /** Shown: the target is taken over, so the program is applied again even if it did not change. */
    start() {
      active = true
      lastCompiled = ''
      appliedKey = ''
      regenerate()
    },
    /** Hidden or gone: the working copy is written at once and nothing more is applied. */
    stop() {
      active = false
      flush()
      clearTimeout(regenTimer)
      clearTimeout(liveTimer)
      liveTimer = undefined
    },
    flush,
    commitEdit,
    recordNow,
    /** A modal move is one undo step however long it pauses: nothing is recorded until the release, which records when asked. */
    holdHistory() {
      commitEdit()
      held = true
      return async (record: boolean) => {
        // the watcher runs on Vue's deferred queue: an edit made just before the release must still meet the hold
        await nextTick()
        held = false
        if (record) recordNow()
      }
    },
    /** The current graph is what "unedited" means; call it once Vue Flow's store holds the edges. */
    resetHistory: () => history.reset(JSON.stringify(snapshot())),
    /** Steps the graph back or forward. A change still waiting out its pause is recorded first, so it can be undone too. */
    travel(step: 'undo' | 'redo') {
      commitEdit()
      const text = history[step]()
      if (!text) return false
      restoring = true
      replace(normalizeDoc(JSON.parse(text)))
      // the watcher answers this replace on the next tick; until it has, nothing is a new edit
      nextTick(() => nextTick(() => (restoring = false)))
      return true
    },
    /** New, Open, Revert and Recover are single acts, not gestures: the working copy follows at once and the history starts clean. */
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

/** Where a compiled program runs: the engine in the app, kept out of this module so the timing rules test without one. */
export interface GraphTarget {
  /** The slot table of the running program; a compile keeps a node's slots from it. */
  readSlots(): SlotTable
  /** Runs `program` with its state laid out by `slots`; returns the GLSL error, or null. */
  load(program: GlslProgram, slots: SlotTable): string | null
  /** Writes one uniform of the running program. */
  set(uniform: ProgramUniform, value: number): void
}

type Timer = ReturnType<typeof setTimeout> | undefined

export interface GraphSessionOptions {
  /** Every edit lands here after a pause; other tabs follow it, a reload comes back to it, and a write from elsewhere replaces the graph. */
  workingCopy: { graph: NodeGraph | null }
  /** Vue Flow's store edges. Vue Flow only syncs its store back to v-model:edges when the edge count changes, so a replaced link never reaches `edges`. */
  storeEdges: () => readonly (LinkEnds & { id: string; style?: unknown })[]
  colorOf: SocketColor
  target: GraphTarget
  compiler: { compile(doc: NodeGraph, options: { slots: SlotTable }): CompileResult<GlslProgram> }
}
