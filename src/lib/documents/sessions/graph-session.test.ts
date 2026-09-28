import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createDefaultGraph } from '@/lib/graph'
import { setValue, setupSession } from './session-harness'

let open: ReturnType<typeof setupSession>

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  open?.scope.stop()
  vi.useRealTimers()
})

describe('the working copy', () => {
  it('is written 350 ms after the last change', async () => {
    open = setupSession()
    const before = open.workingCopy.graph
    setValue(open.session, 'speed', { b: 0.5 })
    await nextTick()
    await vi.advanceTimersByTimeAsync(349)
    expect(open.workingCopy.graph).toBe(before)
    await vi.advanceTimersByTimeAsync(1)
    expect(open.workingCopy.graph!.nodes.find((n) => n.id === 'speed')!.data.values.b).toBe(0.5)
  })

  it('is written at once when the editor is hidden', async () => {
    open = setupSession()
    setValue(open.session, 'speed', { b: 0.5 })
    await nextTick()
    open.session.stop()
    expect(open.workingCopy.graph!.nodes.find((n) => n.id === 'speed')!.data.values.b).toBe(0.5)
  })

  it('replaces the graph when another tab writes it, and ignores its own writes', async () => {
    open = setupSession()
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
    open = setupSession(doc)
    expect(open.session.edges.value.find((e) => e.source === 'time')!.style).toEqual({ stroke: 'color-float', strokeWidth: 2 })
  })
})

describe('history', () => {
  it('records a gesture once it pauses and steps back and forward through it', async () => {
    open = setupSession()
    open.session.resetHistory()
    setValue(open.session, 'speed', { b: 0.5 })
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
    open = setupSession()
    open.session.resetHistory()
    setValue(open.session, 'speed', { b: 0.5 })
    await nextTick()
    expect(open.session.travel('undo')).toBe(true)
    expect(open.session.nodes.value.find((n) => n.id === 'speed')!.data.values.b).toBe(0.2)
  })

  it('a held gesture is one step however long it pauses, and one released unrecorded is none, even with its last edit just before', async () => {
    open = setupSession()
    open.session.resetHistory()
    const b = () => open.session.nodes.value.find((n) => n.id === 'speed')!.data.values.b
    let release = open.session.holdHistory()
    for (const value of [0.3, 0.4, 0.5]) {
      setValue(open.session, 'speed', { b: value })
      await nextTick()
      await vi.advanceTimersByTimeAsync(1000)
    }
    await release(true)
    release = open.session.holdHistory()
    setValue(open.session, 'speed', { b: 0.9 })
    await release(false)
    await vi.advanceTimersByTimeAsync(1000)
    expect(open.session.travel('undo')).toBe(true)
    expect(b()).toBe(0.2)
    await nextTick()
    await nextTick()
    expect(open.session.travel('undo')).toBe(false)
  })

  it('starts clean after a load and writes the loaded graph through', async () => {
    open = setupSession()
    open.session.resetHistory()
    setValue(open.session, 'speed', { b: 0.5 })
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
