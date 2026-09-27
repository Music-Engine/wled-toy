import { FPS } from '@/lib/graph/testing/offline'
import { FRAMES, TARGET_FRAMES } from './config'
import type { Result } from './result'

/** Medians per graph, sorted by frame total (analysis + feed + tick 300) */
export function formatSummaryTable(results: Result[]): string {
  const sumFrameTotal = (result: Result) => result.frame.audioAnalysis.median + result.frame.feed.median + result.frame.tick['strip-300'].median
  const sorted = [...results].sort((a, b) => sumFrameTotal(b) - sumFrameTotal(a))
  const header = ['graph', 'nodes', 'GLSL lines', 'global texels', 'compile', 'GL compile', 'analysis', 'feed', 'feed (batched)', 'tick 300', 'tick 300 (batched)', 'tick 4096', 'preview', 'frame total']
  const rows = sorted.map((result) => [
    result.graph, String(result.nodes), String(result.glslLines), String(result.globalTexels),
    result.compile.compile.median.toFixed(2), result.compile.shaderCompileWall.median.toFixed(1),
    result.frame.audioAnalysis.median.toFixed(2), result.frame.feed.median.toFixed(3), result.frameBatched.feed.toFixed(3),
    result.frame.tick['strip-300'].median.toFixed(2), result.frameBatched.tick['strip-300'].toFixed(3), result.frame.tick['matrix-64x64'].median.toFixed(2),
    result.frame.renderPreview.median.toFixed(2), sumFrameTotal(result).toFixed(2),
  ])
  const table = [header, header.map(() => '---'), ...rows].map((cells) => `| ${cells.join(' | ')} |`).join('\n')
  return [
    '# Graph benchmarks',
    '',
    `WebGL renderer: \`${results[0]?.webglRenderer ?? 'unknown'}\``,
    '',
    `All figures are medians in ms. ${FRAMES} frames per graph at ${FPS} fps, ${TARGET_FRAMES} of them at the LED targets other than strip 60. A tick is the frame pass, the LED pass and the probe readback. Sorted by frame total (analysis + feed + tick 300).`,
    '',
    table,
    '',
    `Per-graph detail, including p95 and max: \`.work/bench/<graph>.json\`.`,
    '',
  ].join('\n')
}
