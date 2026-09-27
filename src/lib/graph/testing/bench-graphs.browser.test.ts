import { describe, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
import { formatSummaryTable } from './bench/report'
import { toResult, type Result } from './bench/result'
import { timeBatches, timeFrames, timeLoading, timeShaderCompile } from './bench/phases'
import { closeTargets, openTargets } from './bench/targets'

// Times each stage of the engine's LED tick as demo-graphs mirrors it; run w/ scripts/bench-graph.sh
const BENCH = import.meta.env.VITE_GRAPH_BENCH === '1'
const ONLY = import.meta.env.VITE_GRAPH_ONLY as string | undefined

const files = {
  ...import.meta.glob('/graphs/*.wledgraph', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('/graphs/bench/*.wledgraph', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>
const graphs = Object.entries(files)
  .map(([path, text]) => [path.split('/').pop()!.replace('.wledgraph', ''), text] as const)
  .sort(([a], [b]) => a.localeCompare(b))

describe.runIf(BENCH)('graph benchmarks', () => {
  const results: Result[] = []
  const selected = graphs.filter(([name]) => !ONLY || name === ONLY)

  it('finds the graphs it is meant to measure', () => {
    expect(selected).not.toEqual([])
  })

  it.each(selected)('%s', async (name, text) => {
    const result = runBenchmark(name, text)
    results.push(result)
    await commands.writeFile(`.work/bench/${name}.json`, JSON.stringify(result, null, 1))
  }, 900_000)

  it('writes the summary', async () => {
    expect(results.length).toBeGreaterThan(0)
    await commands.writeFile('.work/bench/summary.md', formatSummaryTable(results))
  })
})

function runBenchmark(name: string, text: string): Result {
  const loading = timeLoading(name, text)
  const shader = timeShaderCompile(loading.program, loading.table)
  const targets = openTargets(loading.program, loading.table)
  const frames = timeFrames(name, loading.program, targets)
  const batched = timeBatches(loading.program, targets, frames.slots)
  const previewPixels = [targets.canvas.width, targets.canvas.height]
  closeTargets(targets)
  return toResult(name, { loading, shader, frames, batched, previewPixels })
}
