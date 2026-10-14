import { describe, expect, it } from 'vitest'
import { graph, node, renderGraph } from '@/lib/graph/testing'

/** Bytes of a vec2 output on an 8-LED strip at y = 0.5, through the usermod unit */
const render = async (kind: string, output: string, values = {}, leds = 8) =>
  (await renderGraph(graph([node('t', kind, values), node('o', 'output')], [[`t.${output}`, 'o.color']]), { leds })).leds

const toLedCenter = (i: number, leds = 8) => (i + 0.5) / leds

describe('coordinate transforms', () => {
  it('Mirror: 1 at the center falling to 0 at both ends, or the reverse', async () => {
    const toCenter = (await render('mirror', 'uv')).map(([r]) => r)
    expect(toCenter).toEqual([...Array(8).keys()].map((i) => Math.round((1 - Math.abs(toLedCenter(i) - 0.5) / 0.5) * 255)))
    expect(toCenter).toEqual([...toCenter].reverse())
    const fromCenter = (await render('mirror', 'uv', { mode: 'fromCenter' })).map(([r]) => r)
    expect(fromCenter[0]).toBe(223)
    expect(fromCenter[3]).toBe(32)
  }, 30_000)

  it('Mirror on one axis leaves the other alone', async () => {
    expect((await render('mirror', 'uv', { axis: 'y' })).map(([r]) => r)).toEqual([...Array(8).keys()].map((i) => Math.round(toLedCenter(i) * 255)))
  }, 30_000)

  it('Tile: UV restarts in each tile and Cell counts them', async () => {
    expect((await render('tile', 'uv', { count: [2, 1] })).map(([r]) => r)).toEqual([32, 96, 159, 223, 32, 96, 159, 223])
    expect((await render('tile', 'cell', { count: [2, 1] })).map(([r]) => r)).toEqual([0, 0, 0, 0, 255, 255, 255, 255])
  }, 30_000)

  it('Rotate by half a turn flips the strip; by a quarter turn it reads the column', async () => {
    expect((await render('rotate', 'uv', { angle: 0.5 })).map(([r]) => r)).toEqual([...Array(8).keys()].map((i) => Math.round((1 - toLedCenter(i)) * 255)))
    // Quarter turn counter-clockwise: bottom is now right, so x along the strip reads as y;
    // float32 sin and cos of a quarter turn are inexact, so a byte of slack
    const quarter = await render('rotate', 'uv', { angle: 0.25 })
    quarter.forEach(([r, g], i) => {
      expect(Math.abs(r - 128)).toBeLessThanOrEqual(1)
      expect(Math.abs(g - Math.round((1 - toLedCenter(i)) * 255))).toBeLessThanOrEqual(1)
    })
  }, 30_000)

  it('Polar: angle runs 0 to 1 around the center, radius is 0 there', async () => {
    const angle = (await render('polar', 'angle')).map(([r]) => r)
    // Left of center points at pi (the 0 / 1 seam), right at 0, which maps to 0.5
    expect(angle.slice(4)).toEqual([128, 128, 128, 128])
    const radius = (await render('polar', 'radius')).map(([r]) => r)
    expect(radius).toEqual([...Array(8).keys()].map((i) => Math.round(Math.abs(toLedCenter(i) - 0.5) * 2 * 255)))
  }, 30_000)

  it('Segment Split: local restarts, segment counts, fraction spreads over 0 to 1', async () => {
    expect((await render('segmentSplit', 'local', { count: 2 })).map(([r]) => r)).toEqual([32, 96, 159, 223, 32, 96, 159, 223])
    expect((await render('segmentSplit', 'fraction', { count: 4 })).map(([r]) => r)).toEqual([0, 0, 85, 85, 170, 170, 255, 255])
  }, 30_000)
})
