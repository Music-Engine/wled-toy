import { describe, expect, it } from 'vitest'
import { clamp } from './math'

describe('clamp', () => {
  it('keeps a value inside the range and pins one outside it to the nearer bound', () => {
    expect(clamp(0.4, 0, 1)).toBe(0.4)
    expect(clamp(-3, 0, 1)).toBe(0)
    expect(clamp(5000, 1, 4096)).toBe(4096)
  })

  it('passes NaN through, as the copies it replaced did', () => {
    expect(clamp(Number.NaN, 0, 1)).toBeNaN()
  })
})
