import { describe, expect, it } from 'vitest'
import { nextDeadline } from './clock'

describe('nextDeadline', () => {
  it('advances one period from an on-time tick', () => {
    expect(nextDeadline(1000, 20, 1000)).toBe(1020)
  })

  it('advances from the deadline, not the late fire time, so lateness does not accumulate', () => {
    expect(nextDeadline(1000, 20, 1007)).toBe(1020)
  })

  it('resets from now instead of bursting when a tick is more than one period late', () => {
    expect(nextDeadline(1000, 20, 1050)).toBe(1070)
  })

  it('keeps fractional periods exactly', () => {
    const period = 1000 / 60
    let due = 0
    for (let i = 0; i < 60; i++) due = nextDeadline(due, period, due)
    expect(due).toBeCloseTo(1000, 9)
    expect(nextDeadline(0, period, 0)).toBe(period)
  })
})
