import { computed, shallowRef, ref, type Ref } from 'vue'
import { pruneScenes, type CompileResult, type GlslProgram, type NodeGraph, type ProgramUniform, type Scene, type SlotTable, type StoredNode } from '@/lib/graph'
import { clampBetween } from '@/lib/util/math'
import { compileKey } from './compile-key'

/**
 * Knobs, scene fades and MIDI write uniforms and never compile, so apply at once; changed shaders wait for edits to
 * pause, a change only to what the host reads loads at once
 */
export function createCompileSchedule({ initial, nodes, scenes, storeEdges, snapshot, target, compiler }: CompileScheduleOptions) {
  // Tracks ids only, so a knob turn doesn't rebuild it
  const nodesById = computed(() => new Map(nodes.value.map((stored) => [stored.id, stored])))
  const generated = shallowRef(compiler.compile(initial, { slots: target.readSlots() }))
  const compileError = ref<string | null>(null)
  // Node per line of the program the target last took, for tracing GLSL errors
  const compiledLineNodes = shallowRef<GlslProgram['lineNodes']>({ pixel: [], frame: [] })
  let active = false
  let lastCompiled = ''
  let running: GlslProgram | null = null
  // Key `generated` was built from, and the one the target last took
  let generatedKey = ''
  let appliedKey = ''
  let prunedScenes: Scene[] | null = null
  let regenTimer: Timer, liveTimer: Timer

  function regenerate(compileNow = true) {
    const key = compileKey(nodes.value, storeEdges())
    if (key !== generatedKey || scenes.value !== prunedScenes) pruneStaleScenes()
    if (key !== generatedKey) {
      generatedKey = key
      generated.value = compiler.compile(snapshot(), { slots: target.readSlots() })
    }
    if (!active) return
    if (generated.value.program && key !== appliedKey) loadOrDefer(key, compileNow)
    writeKnobUniforms()
  }

  function loadOrDefer(key: string, compileNow: boolean) {
    const { program, slots } = generated.value
    const code = `${program!.frame?.code ?? ''}\n${program!.pixel}`
    if (code !== lastCompiled && !compileNow) {
      clearTimeout(regenTimer)
      regenTimer = setTimeout(regenerate, 250)
      return
    }
    compileError.value = target.load(program!, slots)
    compiledLineNodes.value = program!.lineNodes
    if (!compileError.value) running = program
    appliedKey = key
    lastCompiled = code
  }

  /** Clamped as the Knob node does */
  function writeKnobUniforms() {
    for (const uniform of running?.uniforms ?? []) {
      if (uniform.kind !== 'knob') continue
      const value = nodesById.value.get(uniform.node)?.data.values.value
      if (typeof value === 'number') target.set(uniform, clampBetween(value, uniform.min, uniform.max))
    }
  }

  /** Deleting a knob takes its values out of every scene */
  function pruneStaleScenes() {
    const pruned = pruneScenes(scenes.value, nodes.value)
    // Pruning only drops values; assigning only on a count change keeps this from re-triggering itself
    if (pruned.some((scene, i) => Object.keys(scene.values).length !== Object.keys(scenes.value[i].values).length)) scenes.value = pruned
    prunedScenes = scenes.value
  }

  return {
    generated,
    compileError,
    compiledLineNodes,
    /** At most once per frame: a drag fires on every mouse move */
    regenerateSoon() {
      liveTimer ??= setTimeout(() => {
        liveTimer = undefined
        regenerate(false)
      }, 16)
    },
    /** Target taken over, so the program applies again even unchanged */
    start() {
      active = true
      lastCompiled = ''
      appliedKey = ''
      regenerate()
    },
    stop() {
      active = false
      clearTimeout(regenTimer)
      clearTimeout(liveTimer)
      liveTimer = undefined
    },
  }
}

/** Engine in the app; kept out so the timing rules test w/o one */
export interface GraphTarget {
  /** Compile keeps a node's slots from it */
  readSlots(): SlotTable
  /** Returns the GLSL error, or null */
  load(program: GlslProgram, slots: SlotTable): string | null
  set(uniform: ProgramUniform, value: number): void
}

export type GraphCompiler = { compile(doc: NodeGraph, options: { slots: SlotTable }): CompileResult<GlslProgram> }

export type Timer = ReturnType<typeof setTimeout> | undefined

interface CompileScheduleOptions {
  initial: NodeGraph
  nodes: Ref<StoredNode[]>
  scenes: Ref<Scene[]>
  storeEdges: () => Parameters<typeof compileKey>[1]
  snapshot: () => NodeGraph
  target: GraphTarget
  compiler: GraphCompiler
}
