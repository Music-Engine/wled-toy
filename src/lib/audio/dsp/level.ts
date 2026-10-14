export function rms(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

export function peak(samples: Float32Array): number {
  let max = 0
  for (let i = 0; i < samples.length; i++) max = Math.max(max, Math.abs(samples[i]))
  return max
}

export const toDb = (amplitude: number) => 20 * Math.log10(Math.max(amplitude, 1e-9))
export const fromDb = (db: number) => 10 ** (db / 20)

export interface AgcConfig {
  /** Seconds for the reference level to fall back after the input gets quieter. */
  release: number
  /** Inputs below this (dBFS) are not amplified further, so room noise does not become a light show. */
  floorDb: number
}

/**
 * Automatic gain: follows the recent maximum of a level and returns the gain that maps it to 1.
 * It rises at once (a loud hit must not clip) and falls slowly, so dynamics within a song survive
 * while a quiet source and a loud one end up driving the same range.
 */
export class Agc {
  private reference = 0

  constructor(private readonly config: AgcConfig) {}

  gain(level: number, dt: number): number {
    this.reference = Math.max(level, this.reference * Math.exp(-dt / Math.max(this.config.release, 1e-3)))
    return 1 / Math.max(this.reference, fromDb(this.config.floorDb))
  }
}

/** Open while the level is above the threshold, and for `hold` seconds after, so word gaps and rests do not flicker. */
export class SilenceGate {
  private quietFor = Infinity

  constructor(
    private readonly thresholdDb: number,
    private readonly hold: number,
  ) {}

  open(level: number, dt: number): boolean {
    this.quietFor = toDb(level) >= this.thresholdDb ? 0 : this.quietFor + dt
    return this.quietFor <= this.hold
  }
}
