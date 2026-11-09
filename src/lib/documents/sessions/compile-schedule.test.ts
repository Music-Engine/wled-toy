import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createDefaultGraph, createSlotTable } from '@/lib/graph'
import { buildKnobGraph, setValue, setupSession } from './session-harness'

let open: ReturnType<typeof setupSession>

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  open?.scope.stop()
  vi.useRealTimers()
})

describe('applying the program', () => {
  it('loads once when shown, and nothing while hidden', async () => {
    open = setupSession()
    setValue(open.session, 'speed', { b: 0.5 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(open.target.load).not.toHaveBeenCalled()
    open.session.start()
    expect(open.target.load).toHaveBeenCalledTimes(1)
  })

  it('writes a knob dragged during playback into its uniform within one 16 ms pass, and never compiles', async () => {
    open = setupSession(buildKnobGraph())
    open.session.start()
    const compiled = open.compiles.count
    for (const value of [0.6, 0.9, 1.4, 3]) {
      setValue(open.session, 'knob', { value })
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
    open = setupSession()
    open.session.start()
    setValue(open.session, 'offset', { op: 'subtract' })
    await nextTick()
    await vi.advanceTimersByTimeAsync(16 + 249)
    expect(open.target.load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(open.target.load).toHaveBeenCalledTimes(2)
  })

  it('loads at once a program whose shaders did not change', async () => {
    open = setupSession()
    open.session.start()
    setValue(open.session, 'out', { gamma: 1.8 })
    await nextTick()
    await vi.advanceTimersByTimeAsync(16)
    expect(open.target.load).toHaveBeenCalledTimes(2)
    expect(open.target.load.mock.calls[1][0].output).toMatchObject({ gamma: 1.8 })
  })

  it("compiles against the running program's slot table and loads the table it got back", async () => {
    open = setupSession()
    const running = createSlotTable()
    open.target.readSlots.mockReturnValue(running)
    setValue(open.session, 'offset', { op: 'subtract' })
    await nextTick()
    await vi.advanceTimersByTimeAsync(16)
    open.session.start()
    expect(open.target.readSlots).toHaveBeenCalled()
    expect(open.target.load.mock.calls[0][1]).toBe(open.session.generated.value.slots)
  })

  it('keeps the compile error the target reports', () => {
    open = setupSession()
    open.target.load.mockReturnValue('ERROR: 0:3: broken')
    open.session.start()
    expect(open.session.compileError.value).toBe('ERROR: 0:3: broken')
  })
})

it('drops a deleted knob from every scene', async () => {
  const doc = createDefaultGraph()
  doc.nodes.push({ id: 'knob', type: 'shader', position: { x: 0, y: 0 }, data: { kind: 'knob', values: { value: 0.5 } } })
  doc.scenes = [{ id: 's', name: 'Scene', values: { knob: 0.1 } }]
  open = setupSession(doc)
  open.session.nodes.value = open.session.nodes.value.filter((n) => n.id !== 'knob')
  await nextTick()
  await vi.advanceTimersByTimeAsync(16)
  expect(open.session.scenes.value[0].values).toEqual({})
})
