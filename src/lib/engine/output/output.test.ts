import { describe, expect, it } from 'vitest'
import { DEFAULT_OUTPUT, LedPostProcess, estimateCurrent } from './output'

const frame = (...leds: number[][]) => Float32Array.from(leds.flat())
const rgb = (bytes: Uint8Array) => [...bytes.subarray(4)]

describe('LedPostProcess', () => {
  it('with default settings only quantizes', () => {
    expect(rgb(new LedPostProcess().process(frame([1, 0.5, 0], [0.25, 0, 1]), 1, DEFAULT_OUTPUT))).toEqual([255, 128, 0, 64, 0, 255])
  })

  it('applies master brightness, then gamma', () => {
    const out = new LedPostProcess().process(frame([1, 0.5, 0]), 0.5, { ...DEFAULT_OUTPUT, gamma: 2 })
    expect(rgb(out)).toEqual([Math.round(0.25 * 255), Math.round(0.0625 * 255), 0])
  })

  it('the ceiling scales a bright LED down with its hue kept and leaves dim LEDs alone', () => {
    const out = rgb(new LedPostProcess().process(frame([1, 0.5, 0], [0.2, 0.1, 0]), 1, { ...DEFAULT_OUTPUT, ceiling: 0.5 }))
    expect(out).toEqual([128, 64, 0, 51, 26, 0])
  })

  it('60 white LEDs at 60 mA each are dimmed to fit a 1000 mA budget, hue unchanged', () => {
    const post = new LedPostProcess()
    const white = frame(...Array.from({ length: 60 }, () => [1, 0.5, 0.25]))
    expect(estimateCurrent(white, 20)).toBe(60 * 35)
    const out = rgb(post.process(white, 1, { ...DEFAULT_OUTPUT, powerBudgetMa: 1000 }))
    expect(post.lastCurrentMa).toBeCloseTo(1000, 3)
    const drawn = out.reduce((a, b) => a + b, 0) / 255 * 20
    expect(drawn).toBeLessThanOrEqual(1000 * 1.01)
    expect(drawn).toBeGreaterThan(1000 * 0.97)
    expect(out[0] / out[1]).toBeCloseTo(2, 1)
    expect(out[1] / out[2]).toBeCloseTo(2, 1)
  })

  it('a frame under budget is not touched', () => {
    const post = new LedPostProcess()
    expect(rgb(post.process(frame([1, 1, 1]), 1, { ...DEFAULT_OUTPUT, powerBudgetMa: 1000 }))).toEqual([255, 255, 255])
    expect(post.lastPowerScale).toBe(1)
  })

  it('temporal dithering averages to values between two byte steps; without it they round away', () => {
    const level = 0.5 / 255
    const mean = (dithering: 'off' | 'temporal') => {
      const post = new LedPostProcess()
      let sum = 0
      for (let i = 0; i < 256; i++) sum += post.process(frame([level, level * 0.5, 0]), 1, { ...DEFAULT_OUTPUT, dithering })[4]
      return sum / 256
    }
    expect(mean('temporal')).toBeCloseTo(0.5, 1)
    expect(Math.abs(mean('temporal') - 0.5)).toBeLessThan(0.025)
    expect([0, 1]).toContain(mean('off'))
  })

  it('dithering never strays more than one step from the exact value', () => {
    const post = new LedPostProcess()
    for (let i = 0; i < 100; i++) {
      const value = post.process(frame([0.3337, 0, 0]), 1, { ...DEFAULT_OUTPUT, dithering: 'temporal' })[4]
      expect(Math.abs(value - 0.3337 * 255)).toBeLessThan(1)
    }
  })
})
