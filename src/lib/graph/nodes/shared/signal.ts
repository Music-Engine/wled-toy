import type { NodeContext, Value } from '@/lib/graph/authoring'

/** Fraction of the way to move toward a target this frame so that 63% is covered after `seconds`, at any frame rate. */
export const approach = (dt: number, seconds: number) => (seconds <= 0 ? 1 : 1 - Math.exp(-dt / seconds))

/** `approach` over the frame time the shader has, for a body. */
export const approachFraction = (seconds: string) => `(${seconds} <= 0.0 ? 1.0 : 1.0 - exp(-iTimeDelta / ${seconds}))`

/** True on the frame a signal crosses 0.5 upward. The slot `key` remembers the last side as 0 or 1. */
export function risingEdge<K extends string>(state: NoInfer<Record<K, number>>, key: K, signal: number): boolean {
  const high = signal >= 0.5
  const rose = high && !state[key]
  state[key] = Number(high)
  return rose
}

/** `risingEdge` for a body: a variable that is 1.0 on the frame `signal` crosses 0.5 upward, else 0.0. */
export function risingEdgeFlag(ctx: NodeContext, high: Value, signal: Value, suffix: string): string {
  const flag = ctx.declare('float', `float(${signal.expr} >= 0.5 && ${high.expr} < 0.5)`, suffix).expr
  ctx.emit(`${high.expr} = float(${signal.expr} >= 0.5);`)
  return flag
}

/** A whole number `count` wrapped into 0 to `steps` - 1 as `%` wraps it; mod() alone may round x / x below 1 on a GPU. */
export const wrappedCount = (count: string, steps: string) => `(${count} - ${steps} * floor((${count} + 0.5) / ${steps}))`
