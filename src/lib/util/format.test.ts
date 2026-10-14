import { describe, expect, it } from 'vitest'
import { Format } from './format'

describe('Format.fixed', () => {
  it('rounds to the given decimals and shows a dash for a missing reading', () => {
    expect(Format.fixed(0.5, 2)).toBe('0.50')
    expect(Format.fixed(59.96, 1)).toBe('60.0')
    expect(Format.fixed(12.4, 0)).toBe('12')
    expect(Format.fixed(null, 1)).toBe('-')
    expect(Format.fixed(Number.NaN, 1)).toBe('-')
    expect(Format.fixed(Number.POSITIVE_INFINITY, 0)).toBe('-')
  })
})

describe('Format.clock', () => {
  it('shows minutes, seconds and tenths, flooring each', () => {
    expect(Format.clock(0)).toBe('00:00.0')
    expect(Format.clock(125.39)).toBe('02:05.3')
    expect(Format.clock(59.99)).toBe('00:59.9')
    expect(Format.clock(6000)).toBe('100:00.0')
  })
})

describe('Format.duration', () => {
  it('shows minutes and two-digit seconds', () => {
    expect(Format.duration(192.7)).toBe('3:12')
    expect(Format.duration(5)).toBe('0:05')
  })
})
