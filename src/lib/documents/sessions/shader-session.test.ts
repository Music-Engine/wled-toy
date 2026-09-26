import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { createShaderSession, type ShaderEditSession } from './shader-session'

const code = ref('')
const target = { compile: vi.fn<(code: string) => void>() }
let scope: ReturnType<typeof effectScope>
let session: ShaderEditSession

beforeEach(() => {
  vi.useFakeTimers()
  code.value = 'a'
  target.compile.mockClear()
  scope = effectScope()
  session = scope.run(() => createShaderSession({ code: () => code.value, target }))!
})

afterEach(() => {
  scope.stop()
  vi.useRealTimers()
})

async function type(text: string) {
  code.value = text
  await nextTick()
}

it('compiles the current code at once when shown', () => {
  session.start()
  expect(target.compile.mock.calls).toEqual([['a']])
})

it('compiles an edit once typing pauses for 700 ms', async () => {
  session.start()
  await type('ab')
  await vi.advanceTimersByTimeAsync(500)
  await type('abc')
  await vi.advanceTimersByTimeAsync(699)
  expect(target.compile).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(target.compile.mock.calls).toEqual([['a'], ['abc']])
})

it('an explicit compile cancels the pending one', async () => {
  session.start()
  await type('ab')
  session.compile()
  await vi.advanceTimersByTimeAsync(1000)
  expect(target.compile.mock.calls).toEqual([['a'], ['ab']])
})

it('compiles nothing while hidden, and drops an edit pending when hidden', async () => {
  session.start()
  await type('ab')
  session.stop()
  await vi.advanceTimersByTimeAsync(1000)
  await type('abc')
  session.compileIfShown()
  await vi.advanceTimersByTimeAsync(1000)
  expect(target.compile.mock.calls).toEqual([['a']])
})

it('a loaded shader compiles at once while shown', async () => {
  session.start()
  await type('loaded')
  session.compileIfShown()
  await vi.advanceTimersByTimeAsync(1000)
  expect(target.compile.mock.calls).toEqual([['a'], ['loaded']])
})

it('compiles nothing after its scope is gone', async () => {
  session.start()
  scope.stop()
  await type('ab')
  await vi.advanceTimersByTimeAsync(1000)
  expect(target.compile).toHaveBeenCalledTimes(1)
})
