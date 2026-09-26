import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, shallowRef, watch } from 'vue'
import { createDefaultGraph, type DataType, type GeneratedShader, type NodeGraph, type SocketValue, type StoredEdge } from '@/lib/graph'
import { createGraphSession, type GraphEditSession } from './graph-session'

const colorOf = (type: DataType<any>) => `color-${type.id}`

function setup(graph: NodeGraph | null = createDefaultGraph()) {
  const workingCopy = reactive({ graph: graph as NodeGraph | null })
  const target = { plan: vi.fn<(shader: GeneratedShader) => void>(), compile: vi.fn<(code: string) => string | null>(() => null) }
  const scope = effectScope()
  // Vue Flow's store in the app: it follows the session's edges
  const store = shallowRef<readonly StoredEdge[]>([])
  let session!: GraphEditSession
  scope.run(() => {
    session = createGraphSession({ workingCopy, storeEdges: () => store.value, colorOf, target })
    watch(session.edges, (edges) => (store.value = edges), { immediate: true, flush: 'sync' })
  })
  return { session, workingCopy, target, scope }
}

let open: ReturnType<typeof setup>

/** Edits one node's values the way a knob does: a new data object on the same node. */
function setValue(id: string, values: Record<string, SocketValue>) {
  open.session.nodes.value = open.session.nodes.value.map((n) => (n.id === id ? { ...n, data: { ...n.data, values: { ...n.data.values, ...values } } } : n))
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  open?.scope.stop()
  vi.useRealTimers()
})

describe('applying the program', () => {
  it('compiles and plans once when shown, and nothing while hidden', async () => {
    open = setup()
    setValue('speed', { b: 0.5 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(open.target.plan).not.toHaveBeenCalled()
    open.session.start()
    expect(open.target.plan).toHaveBeenCalledTimes(1)
    expect(open.target.compile).toHaveBeenCalledTimes(1)
  })

  it('applies a knob turn within one 16 ms pass and does not recompile', async () => {
    open = setup()
    open.session.start()
    setValue('speed', { b: 0.5 })
    await nextTick()
    await vi.advanceTimersByTimeAsync(15)
    expect(open.target.plan).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(open.target.plan).toHaveBeenCalledTimes(2)
    expect(open.target.compile).toHaveBeenCalledTimes(1)
  })

  it('holds a shader change and its plan until the edits pause for 250 ms', async () => {
    open = setup()
    open.session.start()
    setValue('offset', { op: 'subtract' })
    await nextTick()
    await vi.advanceTimersByTimeAsync(16 + 249)
    expect(open.target.plan).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(open.target.plan).toHaveBeenCalledTimes(2)
    expect(open.target.compile).toHaveBeenCalledTimes(2)
  })

  it('keeps the compile error the target reports', async () => {
    open = setup()
    open.target.compile.mockReturnValue('ERROR: 0:3: broken')
    open.session.start()
    expect(open.session.compileError.value).toBe('ERROR: 0:3: broken')
  })
})

describe('the working copy', () => {
  it('is written 350 ms after the last change', async () => {
    open = setup()
    const before = open.workingCopy.graph
    setValue('speed', { b: 0.5 })
    await nextTick()
    await vi.advanceTimersByTimeAsync(349)
    expect(open.workingCopy.graph).toBe(before)
    await vi.advanceTimersByTimeAsync(1)
    expect(open.workingCopy.graph!.nodes.find((n) => n.id === 'speed')!.data.values.b).toBe(0.5)
  })

  it('is written at once when the editor is hidden', async () => {
    open = setup()
    setValue('speed', { b: 0.5 })
    await nextTick()
    open.session.stop()
    expect(open.workingCopy.graph!.nodes.find((n) => n.id === 'speed')!.data.values.b).toBe(0.5)
  })

  it('replaces the graph when another tab writes it, and ignores its own writes', async () => {
    open = setup()
    const other = createDefaultGraph()
    other.nodes = other.nodes.filter((n) => n.id !== 'lift')
    open.workingCopy.graph = other
    await nextTick()
    expect(open.session.nodes.value.map((n) => n.id)).not.toContain('lift')
    const nodes = open.session.nodes.value
    open.session.flush()
    await nextTick()
    expect(open.session.nodes.value).toBe(nodes)
  })

  it('colors the links of a hand-written file by their source socket', () => {
    const doc = createDefaultGraph()
    doc.edges = doc.edges.map(({ style: _, ...e }) => e)
    open = setup(doc)
    expect(open.session.edges.value.find((e) => e.source === 'time')!.style).toEqual({ stroke: 'color-float', strokeWidth: 2 })
  })
})

describe('history', () => {
  it('records a gesture once it pauses and steps back and forward through it', async () => {
    open = setup()
    open.session.resetHistory()
    setValue('speed', { b: 0.5 })
    await nextTick()
    await vi.advanceTimersByTimeAsync(350)
    expect(open.session.travel('undo')).toBe(true)
    expect(open.session.nodes.value.find((n) => n.id === 'speed')!.data.values.b).toBe(0.2)
    await nextTick()
    await nextTick()
    expect(open.session.travel('redo')).toBe(true)
    expect(open.session.nodes.value.find((n) => n.id === 'speed')!.data.values.b).toBe(0.5)
  })

  it('undoes an edit still inside its pause', async () => {
    open = setup()
    open.session.resetHistory()
    setValue('speed', { b: 0.5 })
    await nextTick()
    expect(open.session.travel('undo')).toBe(true)
    expect(open.session.nodes.value.find((n) => n.id === 'speed')!.data.values.b).toBe(0.2)
  })

  it('a held gesture is one step however long it pauses, and one released unrecorded is none, even with its last edit just before', async () => {
    open = setup()
    open.session.resetHistory()
    const b = () => open.session.nodes.value.find((n) => n.id === 'speed')!.data.values.b
    let release = open.session.holdHistory()
    for (const value of [0.3, 0.4, 0.5]) {
      setValue('speed', { b: value })
      await nextTick()
      await vi.advanceTimersByTimeAsync(1000)
    }
    await release(true)
    release = open.session.holdHistory()
    setValue('speed', { b: 0.9 })
    await release(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(open.session.travel('undo')).toBe(true)
    expect(b()).toBe(0.2)
    await nextTick()
    await nextTick()
    expect(open.session.travel('undo')).toBe(false)
  })

  it('starts clean after a load and writes the loaded graph through', async () => {
    open = setup()
    open.session.resetHistory()
    setValue('speed', { b: 0.5 })
    await nextTick()
    const loaded = createDefaultGraph()
    loaded.nodes = loaded.nodes.filter((n) => n.id !== 'lift')
    open.session.load(loaded)
    await nextTick()
    expect(open.workingCopy.graph!.nodes.map((n) => n.id)).not.toContain('lift')
    await vi.advanceTimersByTimeAsync(1000)
    expect(open.session.travel('undo')).toBe(false)
  })
})

it('drops a deleted knob from every scene', async () => {
  const doc = createDefaultGraph()
  doc.nodes.push({ id: 'knob', type: 'shader', position: { x: 0, y: 0 }, data: { kind: 'knob', values: { value: 0.5 } } })
  doc.scenes = [{ id: 's', name: 'Scene', values: { knob: 0.1 } }]
  open = setup(doc)
  open.session.nodes.value = open.session.nodes.value.filter((n) => n.id !== 'knob')
  await nextTick()
  await vi.advanceTimersByTimeAsync(16)
  expect(open.session.scenes.value[0].values).toEqual({})
})
