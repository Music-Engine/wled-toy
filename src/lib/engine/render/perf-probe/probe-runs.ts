import { commands } from 'vitest/browser'
import { layoutPositions } from '@/lib/engine/output/layout'
import { PRELUDE } from '@/lib/shader/prelude'
import { ShaderRenderer } from '@/lib/engine/render/renderer'
import { bindProbeTriangle, linkProbeProgram, ReadbackProbe } from './readback-probe'
import { compilePixelPass, createProbeContext, FRAMES, graphText, PREVIEW_SIZES, roundToMicros, summarize, timeBatched, timeFrames, timePreview } from './probe-tools'

const TARGETS = [
  { name: 'strip-60', leds: 60, layout: null },
  { name: 'strip-300', leds: 300, layout: null },
  { name: 'strip-1000', leds: 1000, layout: null },
  { name: 'matrix-16x16', leds: 256, layout: 16 },
  { name: 'matrix-32x32', leds: 1024, layout: 32 },
  { name: 'matrix-64x64', leds: 4096, layout: 64 },
] as const

const usesFeedback = (code: string) => /\b(iPrevFrame|previousFrame)\b/.test(code)

/** Each readback mode per target, then paced runs, for one graph */
export async function measureReadback(name: string): Promise<unknown[]> {
  const code = compilePixelPass(graphText[name])
  const { gl, canvas } = createProbeContext()
  const probe = new ReadbackProbe(gl, code)
  const real = new ShaderRenderer(document.createElement('canvas'))
  real.compile(code)
  const results: unknown[] = TARGETS.map((target) => ({ graph: name, ...measureTarget(probe, real, target) }))
  for (const leds of [300, 4096]) results.push(await measurePacedReadback(probe, name, leds))
  probe.dispose()
  real.dispose()
  canvas.remove()
  return results
}

// Own loop per mode: interleaved, one mode's queued draw is paid for by the next one's wait
function measureTarget(probe: ReadbackProbe, real: ShaderRenderer, target: (typeof TARGETS)[number]) {
  if (target.layout) real.setLayout(layoutPositions({ segments: [{ kind: 'matrix', width: target.layout, height: target.layout, serpentine: false, origin: 'top-left' }] }))
  const none = timeFrames(FRAMES, (frame) => probe.drawOnly(target.leds, frame))
  const sync = timeFrames(FRAMES, (frame) => probe.drawAndReadSync(target.leds, frame))
  probe.lateReads = 0
  probe.reads = 0
  const pbo = timeFrames(FRAMES, (frame) => probe.drawAndReadAsync(target.leds, frame))
  const renderLeds = timeFrames(FRAMES, (frame) => real.renderLeds({ time: frame / 60, dt: 1 / 60, frame, ledCount: target.leds, scanY: 0.5 }))
  return {
    target: target.name,
    leds: target.leds,
    drawOnly: summarize(none),
    syncReadback: summarize(sync),
    pboAsync: summarize(pbo),
    rendererRenderLeds: summarize(renderLeds),
    stallMs: roundToMicros(summarize(sync).median - summarize(none).median),
    pboOverheadMs: roundToMicros(summarize(pbo).median - summarize(none).median),
    pboLateReads: `${probe.lateReads}/${probe.reads}`,
  }
}

// Tight loop gives the fence no wall time, so ticks are spaced as the engine's timer spaces them, where the stall happens
async function measurePacedReadback(probe: ReadbackProbe, name: string, leds: number) {
  probe.lateReads = 0
  probe.reads = 0
  const sync = await timePaced((frame) => probe.drawAndReadSync(leds, frame))
  const pbo = await timePaced((frame) => probe.drawAndReadAsync(leds, frame))
  return {
    graph: name, target: `paced-16ms-${leds}`, leds, drawOnly: summarize([]), syncReadback: summarize(sync), pboAsync: summarize(pbo), rendererRenderLeds: summarize([]),
    stallMs: roundToMicros(summarize(sync).median - summarize(pbo).median), pboOverheadMs: 0, pboLateReads: `${probe.lateReads}/${probe.reads}`,
  }
}

async function timePaced(run: (frame: number) => void): Promise<number[]> {
  const samples: number[] = []
  for (let frame = 0; frame < 60; frame++) {
    await new Promise((resolve) => setTimeout(resolve, 16))
    const t0 = performance.now()
    run(frame)
    if (frame >= 10) samples.push(performance.now() - t0)
  }
  return samples
}

/** 4096-LED sync readback and preview sizes of one node-family variant; null when gen-variants.mjs has not written it */
export async function measureVariant(name: string) {
  const text = await commands.readFile(`.work/perf/gpu/graphs/${name}.wledgraph`).catch(() => null)
  if (typeof text !== 'string') return null
  const code = compilePixelPass(text)
  const { gl, canvas } = createProbeContext()
  const probe = new ReadbackProbe(gl, code)
  const leds4096 = summarize(timeFrames(FRAMES, (frame) => probe.drawAndReadSync(4096, frame)))
  probe.dispose()
  canvas.remove()
  return { variant: name, glslLines: code.split('\n').length, leds4096, preview: measurePreviews(code, PREVIEW_SIZES) }
}

export function measureShowcase(name: string) {
  const code = compilePixelPass(graphText[name])
  return { graph: name, usesFeedback: usesFeedback(code), preview: measurePreviews(code, PREVIEW_SIZES) }
}

function measurePreviews(code: string, sizes: readonly (readonly [number, number])[]): Record<string, unknown> {
  return Object.fromEntries(sizes.map((size) => {
    const { size: key, preview } = timePreview(code, size)
    return [key, preview]
  }))
}

/** Link and first draw, five fresh contexts each */
export function measureCompile(name: string) {
  const full = PRELUDE + compilePixelPass(graphText[name])
  const runs = Array.from({ length: 5 }, () => timeLinkAndFirstDraw(full))
  const timings = { link: summarize(runs.map((run) => run.link)), firstDraw: summarize(runs.map((run) => run.firstDraw)) }
  return { graph: name, hasColorChunk: full.includes('color_srgb_to_scene_linear'), fullLines: full.split('\n').length, full: timings }
}

function timeLinkAndFirstDraw(source: string) {
  const { gl, canvas } = createProbeContext()
  bindProbeTriangle(gl)
  const t0 = performance.now()
  const program = linkProbeProgram(gl, source)
  const link = performance.now() - t0
  const t1 = performance.now()
  gl.useProgram(program)
  gl.viewport(0, 0, 60, 1)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  gl.finish()
  const firstDraw = performance.now() - t1
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  canvas.remove()
  return { link, firstDraw }
}

/** Cost of an uncached getUniformLocation against a cached uniform1i */
export function measureUniformLookup() {
  const presentSource = `#version 300 es
precision highp float;
uniform sampler2D source;
out vec4 color;
void main() { color = vec4(texelFetch(source, ivec2(gl_FragCoord.xy), 0).rgb, 1.0); }`
  const { gl, canvas } = createProbeContext()
  const program = linkProbeProgram(gl, presentSource)
  gl.useProgram(program)
  const calls = 200000
  const getUniformLocationUs = roundToMicros(timeBatched(calls, () => { gl.getUniformLocation(program, 'source') }) * 1000)
  const cached = gl.getUniformLocation(program, 'source')
  const uniform1iUs = roundToMicros(timeBatched(calls, () => { gl.uniform1i(cached, 7) }) * 1000)
  canvas.remove()
  return { getUniformLocationUs, uniform1iUs, batchCalls: calls }
}

/** Preview and 4096-LED ticks at two preview sizes, for graphs w/ and w/o feedback */
export function measureFeedback(name: string) {
  const code = compilePixelPass(graphText[name])
  const sizes = PREVIEW_SIZES.filter(([width]) => width === 480 || width === 1920)
  const perTarget = Object.fromEntries(sizes.map((size) => {
    const { size: key, ...timings } = timePreview(code, size, (renderer) => ({
      leds4096: summarize(timeFrames(60, (frame) => renderer.renderLeds({ time: frame / 60, dt: 1 / 60, frame, ledCount: 4096, scanY: 0.5 }))),
    }))
    return [key, timings]
  }))
  return { usesFeedback: usesFeedback(code), perTarget }
}
