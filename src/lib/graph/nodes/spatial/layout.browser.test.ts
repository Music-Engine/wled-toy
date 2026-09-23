import { describe, expect, it } from 'vitest'
import type { Layout } from '@/lib/engine/layout'
import { createDefaultGraph } from '@/lib/graph'
import { graph, node, renderGraph } from '@/lib/graph/testing'

const uvToColor = graph([node('uv', 'uv'), node('o', 'output')], [['uv.uv', 'o.color']])

describe('LED layout', () => {
  it('a strip layout along the scanline renders exactly what no layout renders', () => {
    const strip: Layout = { segments: [{ kind: 'strip', count: 8, from: [0, 0.5], to: [1, 0.5] }] }
    expect(renderGraph(createDefaultGraph(), { layout: strip }).leds).toEqual(renderGraph(createDefaultGraph()).leds)
  })

  it('a 4 x 4 serpentine matrix shades each LED where it sits, in wire order', () => {
    const layout: Layout = { segments: [{ kind: 'matrix', width: 4, height: 4, serpentine: true, origin: 'bottom-left' }] }
    const { leds } = renderGraph(uvToColor, { leds: 16, layout })
    const cell = (column: number, row: number) => [Math.round(((column + 0.5) / 4) * 255), Math.round(((row + 0.5) / 4) * 255), 0]
    expect(leds.slice(0, 4)).toEqual([cell(0, 0), cell(1, 0), cell(2, 0), cell(3, 0)])
    expect(leds.slice(4, 8)).toEqual([cell(3, 1), cell(2, 1), cell(1, 1), cell(0, 1)])
    expect(leds[15]).toEqual(cell(0, 3))
  })

  it('the LED Layout node gives position, index fraction and segment', () => {
    const layout: Layout = { segments: [{ kind: 'strip', count: 2, from: [0, 0.2], to: [1, 0.2] }, { kind: 'points', points: [[0.5, 0.5, 1], [0.25, 0.75, 0.5]] }] }
    const probe = (output: string) => renderGraph(graph([node('l', 'ledLayout'), node('o', 'output')], [[`l.${output}`, 'o.color']]), { leds: 4, layout }).leds
    expect(probe('position')[2]).toEqual([128, 128, 255])
    expect(probe('position')[3]).toEqual([64, 191, 128])
    expect(probe('segment').map(([r]) => r)).toEqual([0, 0, 255, 255])
    expect(probe('fraction').map(([r]) => r)).toEqual([32, 96, 159, 223])
  })
})
