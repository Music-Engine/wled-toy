import type { NodeContext, Value } from '@/lib/graph/authoring'

/** Per-frame step toward a target covering 63% after `seconds`, at any frame rate */
export const toApproachFraction = (seconds: string) => `(${seconds} <= 0.0 ? 1.0 : 1.0 - exp(-iTimeDelta / ${seconds}))`

/** Per-frame factor fading to about a third after `decay` seconds, at any frame rate */
export const toDecayFactor = (decay: string) => `exp(-iTimeDelta / max(${decay}, 0.0001))`

/** 1.0 on the frame `signal` crosses 0.5 upward, else 0.0; slot `high` keeps the last side */
export function declareRisingEdge(ctx: NodeContext, high: Value, signal: Value, suffix: string): string {
  const flag = ctx.declare('float', `float(${signal.expr} >= 0.5 && ${high.expr} < 0.5)`, suffix).expr
  ctx.emit(`${high.expr} = float(${signal.expr} >= 0.5);`)
  return flag
}

/** Whole `count` wrapped into 0..`steps` - 1 as `%` does; mod() alone may round x / x below 1 on a GPU */
export const wrapCount = (count: string, steps: string) => `(${count} - ${steps} * floor((${count} + 0.5) / ${steps}))`
