import { Float } from '@/lib/graph/authoring'

/** Fraction of the way to move toward a target this frame so that 63% is covered after `seconds`, at any frame rate. */
export const approach = (dt: number, seconds: number) => (seconds <= 0 ? 1 : 1 - Math.exp(-dt / seconds))

/** True on the frame a signal crosses 0.5 upward. The Bool slot `key` remembers the last side. */
export function risingEdge<K extends string>(state: NoInfer<Record<K, boolean>>, key: K, signal: number): boolean {
  const high = signal >= 0.5
  const rose = high && !state[key]
  state[key] = high
  return rose
}

export const seconds = (fallback: number) => ({ type: Float, default: fallback, props: { min: 0, step: 0.01, decimals: 3 } })
