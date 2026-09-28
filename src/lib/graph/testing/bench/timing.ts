interface Timing {
  median: number
  p95: number
  max: number
  samples: number
}

export function summarizeTimes(values: number[]): Timing {
  const sorted = [...values].sort((a, b) => a - b)
  const readQuantile = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  return {
    median: roundToMillis(readQuantile(0.5)),
    p95: roundToMillis(readQuantile(0.95)),
    max: roundToMillis(sorted[sorted.length - 1] ?? 0),
    samples: sorted.length,
  }
}

/**
 * performance.now() is clamped to 0.1 ms here, so a cheaper stage reads 0 or 0.1; `calls` repeats divided put the
 * quantum below it. Repeats reuse one frame's inputs, so a stateful stage steps `calls` times
 */
export function timeBatch(calls: number, run: () => void): number {
  const t0 = performance.now()
  for (let i = 0; i < calls; i++) run()
  return roundToMillis((performance.now() - t0) / calls)
}

/** Graphics adapter, so SwiftShader numbers never pass for hardware ones */
export function readRendererName(): string {
  const gl = document.createElement('canvas').getContext('webgl2')
  if (!gl) return 'no webgl2'
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const unmasked = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null
  return `${unmasked ?? gl.getParameter(gl.RENDERER)} | ${gl.getParameter(gl.VERSION)}`
}

export const readHeapUsed = () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize

const roundToMillis = (value: number) => Math.round(value * 1000) / 1000
