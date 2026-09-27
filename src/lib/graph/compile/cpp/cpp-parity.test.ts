import { describe, expect, it } from 'vitest'
import { MATH_OPS } from '@/lib/graph/nodes/converter/math'
import { VECTOR_OPS } from '@/lib/graph/nodes/converter/vector-math'
import { buildCpp, cppCompiler } from '@/lib/graph/testing/cpp'
import { cppParity } from './cpp-parity'

it('covers every operation in MATH_OPS and VECTOR_OPS', () => {
  expect(cppParity().ops).toHaveLength(Object.keys(MATH_OPS).length + Object.keys(VECTOR_OPS).length)
})

describe.skipIf(!cppCompiler)('the C++ build (needs g++ or c++ on PATH)', () => {
  it('computes every operation as its frame body does, within 1e-5', () => {
    const { code, ops } = cppParity()
    const { status, output } = buildCpp(code, { run: true })
    const passed = output.split('\n').filter((line) => line.startsWith('ok ')).map((line) => line.split(' ')[1])
    expect(passed, output).toEqual(ops)
    expect(status, output).toBe(0)
  }, 60_000)
})
