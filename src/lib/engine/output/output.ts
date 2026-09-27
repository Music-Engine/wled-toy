export type WireProtocol = 'ddp' | 'dnrgb' | 'artnet' | 'sacn'

/** What happens between the shader's colors and the bytes on the wire. A graph's Output node supplies these. */
export interface OutputSettings {
  /** Exponent applied per channel; 1 leaves the colors linear. LEDs are linear devices, so 2.2 to 2.8 makes fades look even. */
  gamma: number
  /** Largest value any channel may reach, 0 to 1. Brighter pixels are scaled down with their hue kept. */
  ceiling: number
  /** Total current allowed for the strip in mA; 0 is no limit. The whole frame is dimmed to fit. */
  powerBudgetMa: number
  /** Current one color channel of one LED draws at full brightness. About 20 mA for WS2812B. */
  maPerChannel: number
  /** Temporal dithering flickers the last bit between frames so dim fades do not move in visible steps. */
  dithering: 'off' | 'temporal'
  /** 0 keeps the frame rate from Settings. */
  fps: number
  protocol: WireProtocol | 'settings'
  /** First DMX universe for Art-Net and sACN. */
  universe: number
}

export const DEFAULT_OUTPUT: OutputSettings = { gamma: 1, ceiling: 1, powerBudgetMa: 0, maPerChannel: 20, dithering: 'off', fps: 0, protocol: 'settings', universe: 0 }

/** Estimated current of a frame of 0..1 colors, in mA. */
export function estimateCurrent(colors: Float32Array, maPerChannel: number): number {
  let sum = 0
  for (let i = 0; i < colors.length; i++) sum += colors[i]
  return sum * maPerChannel
}

/** Turns a frame of linear 0..1 RGB into wire bytes. Holds the dithering error between frames. */
export class LedPostProcess {
  private carry = new Float32Array(0)
  private work = new Float32Array(0)
  /** Current the last frame was estimated to draw after limiting, and the factor the budget dimmed it by. */
  lastCurrentMa = 0
  lastPowerScale = 1

  /** `colors` is r, g, b per LED. Returns [4 reserved header bytes, r, g, b, ...]. */
  process(colors: Float32Array, brightness: number, settings: OutputSettings): Uint8Array<ArrayBuffer> {
    const n = colors.length
    if (this.work.length !== n) {
      this.work = new Float32Array(n)
      this.carry = new Float32Array(n)
    }
    const work = this.work
    for (let i = 0; i < n; i += 3) {
      const peak = Math.max(colors[i], colors[i + 1], colors[i + 2], 1e-6)
      // one factor per LED, so limiting the brightest channel does not shift the hue
      const scale = brightness * Math.min(1, settings.ceiling / peak)
      for (let c = 0; c < 3; c++) work[i + c] = Math.min(1, Math.max(0, colors[i + c] * scale)) ** settings.gamma
    }

    const current = estimateCurrent(work, settings.maPerChannel)
    this.lastPowerScale = settings.powerBudgetMa > 0 && current > settings.powerBudgetMa ? settings.powerBudgetMa / current : 1
    this.lastCurrentMa = current * this.lastPowerScale

    const out = new Uint8Array(4 + n)
    for (let i = 0; i < n; i++) {
      const exact = work[i] * this.lastPowerScale * 255
      if (settings.dithering === 'temporal') {
        // what rounding down loses this frame is added to the next, so the average over time is exact
        const value = Math.floor(exact + this.carry[i])
        this.carry[i] += exact - value
        out[4 + i] = value
      } else {
        out[4 + i] = Math.round(exact)
      }
    }
    return out
  }
}
