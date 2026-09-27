import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, shallowRef, watch } from 'vue'
import { createDefaultGraph, emptySlots, createGlslCompiler, type DataType, type GlslProgram, type NodeGraph, type ProgramUniform, type SlotTable, type SocketValue, type StoredEdge } from '@/lib/graph'
import { createGraphSession, type GraphEditSession } from './graph-session'

const colorOf = (type: DataType<any>) => `color-${type.id}`

/** The default graph with a Knob feeding the speed, so a program has a uniform to write. */
function withKnob(): NodeGraph {
  const doc = createDefaultGraph()
  doc.nodes.push({ id: 'knob', type: 'shader', position: { x: 0, y: 0 }, data: { kind: 'knob', values: { value: 0.5, max: 2 } } })
  doc.edges.push({ id: 'knob-speed', source: 'knob', sourceHandle: 'value', target: 'speed', targetHandle: 'b' })
  return doc
}

function setup(graph: NodeGraph | null = createDefaultGraph()) {
  const workingCopy = reactive({ graph: graph as NodeGraph | null })
  const target = {
    readSlots: vi.fn<() => SlotTable>(() => emptySlots()),
    load: vi.fn<(program: GlslProgram, slots: SlotTable) => string | null>(() => null),
    set: vi.fn<(uniform: ProgramUniform, value: number) => void>(),
  }
  // counted through the compiler's own hook: once per compile that reaches a target
  const compiles = { count: 0 }
  const compiler = createGlslCompiler({ hooks: { target: () => compiles.count++ } })
  const scope = effectScope()
  // Vue Flow's store in the app: it follows the session's edges
  const store = shallowRef<readonly StoredEdge[]>([])
  let session!: GraphEditSession
  scope.run(() => {
    session = createGraphSession({ workingCopy, storeEdges: () => store.value, colorOf, target, compiler })
    watch(session.edges, (edges) => (store.value = edges), { immediate: true, flush: 'sync' })
  })
  return { session, workingCopy, target, compiles, scope }
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
  it('loads once when shown, and nothing while hidden', async () => {
    open = setup()
    setValue('speed', { b: 0.5 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(open.target.load).not.toHaveBeenCalled()
    open.session.start()
    expect(open.target.load).toHaveBeenCalledTimes(1)
  })

  it('writes a knob dragged during playback into its uniform within one 16 ms pass, and never compiles', async () => {
    open = setup(withKnob())
    open.session.start()
    const compiled = open.compiles.count
    for (const value of [0.6, 0.9, 1.4, 3]) {
      setValue('knob', { value })
      await nextTick()
      await vi.advanceTimersByTimeAsync(16)
    }
    expect(open.compiles.count).toBe(compiled)
    expect(open.target.load).toHaveBeenCalledTimes(1)
    const [uniform] = open.target.load.mock.calls[0][0].uniforms
    expect(uniform).toMatchObject({ node: 'knob', kind: 'knob', default: 0.5 })
    expect(open.target.set.mock.calls.map(([, value]) => value).slice(-4)).toEqual([0.6, 0.9, 1.4, 2])
  })

  it('holds a program whose shaders changed until the edits pause for 250 ms', async () => {
    open = setup()
    open.session.start()
    setValue('offset', { op: 'subtract' })
    await nextTick()
    await vi.advanceTimersByTimeAsync(16 + 249)
    expect(open.target.load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(open.target.load).toHaveBeenCalledTimes(2)
  })

  it('loads at once a program whose shaders did not change', async () => {
    open = setup()
    open.session.start()
    setValue('out', { gamma: 1.8 })
    await nextTick()
    await vi.advanceTimersByTimeAsync(16)
    expect(open.target.load).toHaveBeenCalledTimes(2)
    expect(open.target.load.mock.calls[1][0].output).toMatchObject({ gamma: 1.8 })
  })

  it('compiles against the running program\'s slot table and loads the table it got back', async () => {
    open = setup()
    const running = emptySlots()
    open.target.readSlots.mockReturnValue(running)
    setValue('offset', { op: 'subtract' })
    await nextTick()
    await vi.advanceTimersByTimeAsync(16)
    open.session.start()
    expect(open.target.readSlots).toHaveBeenCalled()
    expect(open.target.load.mock.calls[0][1]).toBe(open.session.generated.value.slots)
  })

  it('keeps the compile error the target reports', () => {
    open = setup()
    open.target.load.mockReturnValue('ERROR: 0:3: broken')
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
