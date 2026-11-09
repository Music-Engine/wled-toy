export const FRAMES = Number(import.meta.env.VITE_GRAPH_BENCH_FRAMES ?? 300)
export const TARGET_FRAMES = Number(import.meta.env.VITE_GRAPH_BENCH_TARGET_FRAMES ?? 60)
export const WARMUP = 10
export const COMPILES = 20
export const PREVIEW_SIZE = [480, 270]
/** Repeats for sub-0.1 ms stages; see `timeBatch` */
export const BATCH = 500

export const TARGETS = [
  { name: 'strip-60', leds: 60, layout: null },
  { name: 'strip-300', leds: 300, layout: null },
  { name: 'strip-1000', leds: 1000, layout: null },
  { name: 'matrix-16x16', leds: 256, layout: 16 },
  { name: 'matrix-32x32', leds: 1024, layout: 32 },
  { name: 'matrix-64x64', leds: 4096, layout: 64 },
] as const
