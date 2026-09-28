import { describe, expect, it } from 'vitest'
import { graph, node, renderGraph } from '@/lib/graph/testing'

const renderOne = async (kind: string, output: string, values: object, leds = 1) =>
  (await renderGraph(graph([node('n', kind, values as never), node('o', 'output')], [[`n.${output}`, 'o.color']]), { leds })).leds
const renderReds = async (kind: string, output: string, values: object, leds: number) => (await renderOne(kind, output, values, leds)).map(([r]) => r)

describe('compositing', () => {
  const layers = { base: [0.2, 0.4, 0.6], layer: [1, 0, 0] }

  it('Layer Mix: a mask of 0 shows the base, a mask of 1 at full opacity shows the layer, and the two multiply', async () => {
    expect((await renderOne('layerMix', 'color', { ...layers, mask: 0 }))[0]).toEqual([51, 102, 153])
    expect((await renderOne('layerMix', 'color', { ...layers, mask: 1, opacity: 1 }))[0]).toEqual([255, 0, 0])
    expect((await renderOne('layerMix', 'color', { ...layers, mask: 0.5, opacity: 0.5 }))[0]).toEqual((await renderOne('layerMix', 'color', { ...layers, mask: 0.25, opacity: 1 }))[0])
  }, 30_000)

  it('Layer Mix uses the blend modes of Color Mix', async () => {
    expect((await renderOne('layerMix', 'color', { base: [0.5, 0.5, 0.5], layer: [1, 0, 0], mode: 'multiply' }))[0]).toEqual([128, 0, 0])
  })

  it('Mask: hard with no softness, a ramp with some, inverted on request', async () => {
    expect(await renderReds('mask', 'mask', { softness: 0 }, 4)).toEqual([0, 0, 255, 255])
    const soft = await renderReds('mask', 'mask', { softness: 1 }, 4)
    expect(soft[0]).toBeGreaterThan(0)
    expect(soft[3]).toBeLessThan(255)
    expect(soft).toEqual([...soft].sort((a, b) => a - b))
    expect(await renderReds('mask', 'mask', { softness: 0, invert: true }, 4)).toEqual([255, 255, 0, 0])
  }, 30_000)

  it('Brightness Ceiling scales down to the ceiling, keeps the hue, and leaves dim colors alone', async () => {
    expect((await renderOne('brightnessCeiling', 'color', { color: [1, 0.5, 0], ceiling: 0.5 }))[0]).toEqual([128, 64, 0])
    expect((await renderOne('brightnessCeiling', 'color', { color: [0.2, 0.12, 0], ceiling: 0.5 }))[0]).toEqual([51, 31, 0])
  }, 30_000)

  it('Palette: presets start and end where their tables say, and Repeat wraps', async () => {
    const heat = await renderOne('gradientPalette', 'color', { palette: 'heat', repeat: false }, 64)
    expect(heat[0][0]).toBeLessThan(12)
    // Last LED sits half a cell before 1: almost the final white
    expect(Math.min(...heat[63])).toBeGreaterThan(240)
    const renderAt = async (position: number) => (await renderGraph(graph(
      [node('v', 'value', { value: position }), node('p', 'gradientPalette', { palette: 'party' }), node('o', 'output')],
      [['v.value', 'p.position'], ['p.color', 'o.color']],
    ), { leds: 1 })).leds[0]
    expect(await renderAt(1.25)).toEqual(await renderAt(0.25))
    expect(await renderAt(0)).toEqual([85, 0, 171])
  }, 30_000)
})
