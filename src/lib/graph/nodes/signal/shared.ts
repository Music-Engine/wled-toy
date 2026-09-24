/** True on the frame a signal crosses 0.5 upward. The Bool slot `key` remembers the last side. */
export function risingEdge<K extends string>(state: NoInfer<Record<K, boolean>>, key: K, signal: number): boolean {
  const high = signal >= 0.5
  const rose = high && !state[key]
  state[key] = high
  return rose
}
