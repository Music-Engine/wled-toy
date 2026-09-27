import { vi } from 'vitest'
import { effectScope, reactive, shallowRef, watch } from 'vue'
import { createDefaultGraph, createSlotTable, createGlslCompiler, type DataType, type GlslProgram, type NodeGraph, type ProgramUniform, type SlotTable, type SocketValue, type StoredEdge } from '@/lib/graph'
import { createGraphSession, type GraphEditSession } from './graph-session'

/** Session over a mocked target, compiles counted, Vue Flow's store following its edges */
export function setupSession(graph: NodeGraph | null = createDefaultGraph()) {
  const workingCopy = reactive({ graph: graph as NodeGraph | null })
  const target = {
    readSlots: vi.fn<() => SlotTable>(() => createSlotTable()),
    load: vi.fn<(program: GlslProgram, slots: SlotTable) => string | null>(() => null),
    set: vi.fn<(uniform: ProgramUniform, value: number) => void>(),
  }
  // Counted via the compiler's hook: once per compile reaching a target
  const compiles = { count: 0 }
  const compiler = createGlslCompiler({ hooks: { target: () => compiles.count++ } })
  const scope = effectScope()
  const store = shallowRef<readonly StoredEdge[]>([])
  let session!: GraphEditSession
  scope.run(() => {
    session = createGraphSession({ workingCopy, storeEdges: () => store.value, colorOf: (type: DataType<any>) => `color-${type.id}`, target, compiler })
    watch(session.edges, (edges) => (store.value = edges), { immediate: true, flush: 'sync' })
  })
  return { session, workingCopy, target, compiles, scope }
}

/** Default graph w/ a Knob feeding the speed, so the program has a uniform */
export function buildKnobGraph(): NodeGraph {
  const doc = createDefaultGraph()
  doc.nodes.push({ id: 'knob', type: 'shader', position: { x: 0, y: 0 }, data: { kind: 'knob', values: { value: 0.5, max: 2 } } })
  doc.edges.push({ id: 'knob-speed', source: 'knob', sourceHandle: 'value', target: 'speed', targetHandle: 'b' })
  return doc
}

/** As a knob edits: new data object on the same node */
export function setValue(session: GraphEditSession, id: string, values: Record<string, SocketValue>) {
  session.nodes.value = session.nodes.value.map((stored) => (stored.id === id ? { ...stored, data: { ...stored.data, values: { ...stored.data.values, ...values } } } : stored))
}
