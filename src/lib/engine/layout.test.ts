import { describe, expect, it } from 'vitest'
import { isStripLayout, layoutCount, layoutPositions, parseLayout, type Layout, type Segment } from './layout'

const xy = (layout: Layout) => {
  const p = layoutPositions(layout)
  return Array.from({ length: p.length / 4 }, (_, i) => [Number(p[i * 4].toFixed(4)), Number(p[i * 4 + 1].toFixed(4))])
}

describe('layoutPositions', () => {
  it('strip: LEDs at cell centers, like the pixels of the LED pass', () => {
    expect(xy({ segments: [{ kind: 'strip', count: 4, from: [0, 0.5], to: [1, 0.5] }] })).toEqual([[0.125, 0.5], [0.375, 0.5], [0.625, 0.5], [0.875, 0.5]])
  })

  it('ring: LED 0 at the start angle, the LED half way around is diametrically opposite', () => {
    const ring = xy({ segments: [{ kind: 'ring', count: 12, center: [0.5, 0.5], radius: 0.4, startAngle: 0, clockwise: false }] })
    expect(ring[0]).toEqual([0.9, 0.5])
    expect(ring[6]).toEqual([0.1, 0.5])
    expect(ring[3]).toEqual([0.5, 0.9])
    const clockwise = xy({ segments: [{ kind: 'ring', count: 12, center: [0.5, 0.5], radius: 0.4, startAngle: 0, clockwise: true }] })
    expect(clockwise[3]).toEqual([0.5, 0.1])
  })

  it('matrix: serpentine reverses every other row; origin picks which row is first', () => {
    const matrix = (serpentine: boolean, origin: 'top-left' | 'bottom-left') => xy({ segments: [{ kind: 'matrix', width: 3, height: 2, serpentine, origin }] })
    expect(matrix(false, 'bottom-left')).toEqual([[0.1667, 0.25], [0.5, 0.25], [0.8333, 0.25], [0.1667, 0.75], [0.5, 0.75], [0.8333, 0.75]])
    expect(matrix(true, 'bottom-left').slice(3)).toEqual([[0.8333, 0.75], [0.5, 0.75], [0.1667, 0.75]])
    expect(matrix(false, 'top-left')[0]).toEqual([0.1667, 0.75])
  })

  it('points keep z, and segments carry their index', () => {
    const layout: Layout = { segments: [{ kind: 'strip', count: 2, from: [0, 0], to: [1, 0] }, { kind: 'points', points: [[0.2, 0.3, 0.9], [0.4, 0.5]] }] }
    expect(layoutCount(layout)).toBe(4)
    expect([...layoutPositions(layout).slice(8)].map((v) => Number(v.toFixed(2)))).toEqual([0.2, 0.3, 0.9, 1, 0.4, 0.5, 0, 1])
  })
})

describe('isStripLayout', () => {
  it('holds for no layout and for strips only; one matrix, ring or point list ends it', () => {
    const strip: Segment = { kind: 'strip', count: 4, from: [0, 0.5], to: [1, 0.5] }
    expect(isStripLayout(null)).toBe(true)
    expect(isStripLayout({ segments: [strip, strip] })).toBe(true)
    expect(isStripLayout({ segments: [strip, { kind: 'ring', count: 8, center: [0.5, 0.5], radius: 0.4, startAngle: 0, clockwise: true }] })).toBe(false)
    expect(isStripLayout({ segments: [{ kind: 'matrix', width: 2, height: 2, serpentine: false, origin: 'top-left' }] })).toBe(false)
  })
})

describe('parseLayout', () => {
  it('accepts what layoutPositions understands and nothing else', () => {
    expect(parseLayout({ segments: [{ kind: 'ring', count: 8, center: [0.5, 0.5], radius: 0.3, startAngle: 0, clockwise: true }] })).not.toBeNull()
    expect(parseLayout({ segments: [] })).toBeNull()
    expect(parseLayout({ segments: [{ kind: 'strip', count: 0, from: [0, 0], to: [1, 1] }] })).toBeNull()
    expect(parseLayout({ segments: [{ kind: 'points', points: [[0.1]] }] })).toBeNull()
    expect(parseLayout({ segments: [{ kind: 'matrix', width: 100, height: 100, serpentine: true, origin: 'top-left' }] })).toBeNull()
    expect(parseLayout(null)).toBeNull()
  })
})
