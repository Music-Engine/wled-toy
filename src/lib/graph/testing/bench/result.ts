import type { NodeGraph } from '@/lib/graph/model/doc'
import type { GlslProgram } from '@/lib/graph/compile/compilers'
import { FPS } from '@/lib/graph/testing/offline'
import { FRAMES, TARGETS, TARGET_FRAMES } from './config'
import type { timeBatches, timeFrames, timeLoading, timeShaderCompile } from './phases'
import { readRendererName, summarizeTimes } from './timing'

export type Result = ReturnType<typeof toResult>

interface Phases {
  loading: ReturnType<typeof timeLoading>
  shader: ReturnType<typeof timeShaderCompile>
  frames: ReturnType<typeof timeFrames>
  batched: ReturnType<typeof timeBatches>
  previewPixels: number[]
}

/** One graph's JSON: sizes, compile and per-frame timings, batched costs, heap growth */
export function toResult(name: string, { loading, shader, frames, batched, previewPixels }: Phases) {
  const { doc, program } = loading
  const { heapStart, heapEnd } = frames
  return {
    graph: name,
    webglRenderer: readRendererName(),
    frames: FRAMES,
    targetFrames: TARGET_FRAMES,
    fps: FPS,
    ...measureSize(doc, program),
    analysisSlots: frames.slots.length,
    previewPixels,
    compile: {
      readGraphFile: summarizeTimes(loading.readTimes),
      compile: summarizeTimes(loading.compileTimes),
      shaderCompileReported: summarizeTimes(shader.glCompile),
      shaderCompileWall: summarizeTimes(shader.glWall),
      firstRenderAfterCompile: summarizeTimes(shader.firstDraw),
    },
    frame: {
      audioAnalysis: summarizeTimes(frames.analysis),
      audioAnalysisPerHop: summarizeTimes(frames.perHop),
      feed: summarizeTimes(frames.feed),
      renderPreview: summarizeTimes(frames.renderPreview),
      tick: Object.fromEntries(TARGETS.map((target) => [target.name, summarizeTimes(frames.tick[target.name])])),
    },
    frameBatched: batched,
    heap:
      heapStart && heapEnd
        ? { startBytes: heapStart, endBytes: heapEnd, growthBytes: heapEnd - heapStart, bytesPerFrame: Math.round((heapEnd - heapStart) / FRAMES) }
        : null,
  }
}

function measureSize(doc: NodeGraph, program: GlslProgram) {
  const code = `${program.frame?.code ?? ''}${program.pixel}`
  return {
    nodes: doc.nodes.length,
    edges: doc.edges.length,
    glslChars: code.length,
    glslLines: code.split('\n').length,
    globalTexels: program.frame?.texels ?? 0,
    uniforms: program.uniforms.length,
    usesFeedback: /\b(iPrevFrame|previousFrame)\b/.test(program.pixel),
  }
}
