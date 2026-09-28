import { describe, it } from 'vitest'
import { measureCompile, measureFeedback, measureReadback, measureShowcase, measureUniformLookup, measureVariant } from './probe-runs'
import { FRAMES, graphText, readEnvironment, writeReport } from './probe-tools'

// Numbers behind graphs/bench/reports/profile-gpu.md; VITE_PERF_GPU=1 runs it, BENCH_GPU=1 on hardware. Private
// probe contexts draw the same emitted GLSL, so readback strategies compare on one draw w/o changing ShaderRenderer
const RUN = import.meta.env.VITE_PERF_GPU === '1'

const VARIANTS = ['gpu-full', 'gpu-drop-noise', 'gpu-drop-voronoi', 'gpu-drop-magic', 'gpu-drop-brick', 'gpu-drop-wave', 'gpu-drop-ramp', 'gpu-drop-mix', 'gpu-drop-all']

describe.runIf(RUN)('gpu path probe', () => {
  const env = readEnvironment()

  it('records the environment', async () => {
    await writeReport('environment', env)
  })

  it('readback strategies per graph and target', async () => {
    const results: unknown[] = []
    for (const name of ['bench-baseline', 'bench-gpu-heavy', 'bench-kitchen-sink', 'liquid-nebula', 'spectral-aurora']) results.push(...await measureReadback(name))
    await writeReport('readback', { env, frames: FRAMES, results })
  }, 900_000)

  it('pixel node families and preview resolution', async () => {
    const variants: unknown[] = []
    for (const name of VARIANTS) {
      const measured = await measureVariant(name)
      if (measured) variants.push(measured)
    }
    const showcase = ['bar-sequencer', 'chroma-keys', 'high-contrast-music', 'kick-shockwave', 'liquid-nebula', 'peak-meteor', 'spectral-aurora'].map(measureShowcase)
    await writeReport('families', { env, frames: FRAMES, variants, showcase })
  }, 1_800_000)

  it('shader compile cost', async () => {
    await writeReport('compile', { env, results: Object.keys(graphText).sort().map(measureCompile) })
  }, 900_000)

  it('feedback ping-pong and the uncached uniform lookup', async () => {
    const graphs = Object.fromEntries(['bench-feedback', 'bench-baseline', 'liquid-nebula', 'peak-meteor'].map((name) => [name, measureFeedback(name)]))
    await writeReport('feedback', { env, results: { ...measureUniformLookup(), ...graphs } })
  }, 900_000)
})
