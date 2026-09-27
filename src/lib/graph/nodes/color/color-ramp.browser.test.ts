import { describe, expect, it } from 'vitest'
import { RAMP_INTERPOLATIONS, sampleRamp, type ColorRamp } from './color-ramp'
import { graph, node, tickGraph } from '@/lib/graph/testing'

describe('color ramp', () => {
  const stops = [{ position: 0, color: [1, 0, 0] }, { position: 0.3, color: [0, 1, 0] }, { position: 0.3, color: [0, 0.2, 1] }, { position: 1, color: [1, 1, 1] }]

  it.each(RAMP_INTERPOLATIONS.map((option) => option.value))('%s: the shader and the editor preview agree', (interpolation) => {
    const ramp: ColorRamp = { interpolation, stops }
    const leds = 16
    // WebGL: the B-spline's GLSL array constructor has no C++ form
    const [rendered] = tickGraph(graph([node('r', 'colorRamp', { ramp }), node('o', 'output')], [['r.color', 'o.color']]), { leds })
    rendered.forEach((led, i) => {
      const expected = sampleRamp(ramp, (i + 0.5) / leds).map((channel) => Math.min(1, Math.max(0, channel)) * 255)
      led.forEach((channel, k) => expect(Math.abs(channel - expected[k]), `LED ${i} channel ${k}`).toBeLessThanOrEqual(2))
    })
  })
})
