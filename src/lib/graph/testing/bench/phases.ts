import { expect } from 'vitest'
import type { Features } from '@/lib/audio/dsp'
import { ShaderRenderer } from '@/lib/engine/render/renderer'
import { Runtime } from '@/lib/engine/runtime'
import { createGlslCompiler, type GlslProgram, type SlotTable } from '@/lib/graph/compile/compilers'
import { readGraphFile } from '@/lib/graph/model/file'
import { FPS, SAMPLE_RATE, feedSlots, openSlots, synthesizeTrack, type Slot } from '@/lib/graph/testing/offline'
import { BATCH, COMPILES, FRAMES, TARGETS, TARGET_FRAMES, WARMUP } from './config'
import type { Targets } from './targets'
import { readHeapUsed, timeBatch } from './timing'

/** Reading and compiling the file, each timed over COMPILES after WARMUP */
export function timeLoading(name: string, text: string) {
  const readTimes = timeRepeats(() => readGraphFile(text))
  const { doc, problems } = readGraphFile(text)
  expect(problems, `${name}: structural problems`).toEqual([])
  const compileTimes = timeRepeats(() => createGlslCompiler().compile(doc))
  const { program, slots: table, issues } = createGlslCompiler().compile(doc)
  expect(issues.map((issue) => `${issue.nodeId}: ${issue.message}`), `${name}: graph issues`).toEqual([])
  return { doc, readTimes, compileTimes, program: program!, table }
}

/** Reported and wall GL compile, and the first draw, which some drivers finish the compile on */
export function timeShaderCompile(program: GlslProgram, table: SlotTable) {
  const times = { glCompile: [] as number[], glWall: [] as number[], firstDraw: [] as number[] }
  for (let i = 0; i < 3; i++) {
    const renderer = new ShaderRenderer(document.createElement('canvas'))
    const runtime = new Runtime(renderer)
    const t0 = performance.now()
    times.glCompile.push(runtime.load(program, table)!)
    times.glWall.push(performance.now() - t0)
    const t1 = performance.now()
    runtime.tick({ time: 0, dt: 1 / FPS, frame: 0, ledCount: 60, scanY: 0.5 })
    times.firstDraw.push(performance.now() - t1)
    renderer.dispose()
  }
  return times
}

/** The engine's LED tick per frame over the synthetic track: analysis, feed, preview, then each target's tick */
export function timeFrames(name: string, program: GlslProgram, targets: Targets) {
  const track = synthesizeTrack(Math.ceil(FRAMES / FPS) + 1)
  const slots = openSlots(program, SAMPLE_RATE)
  const times = { analysis: [] as number[], perHop: [] as number[], feed: [] as number[], renderPreview: [] as number[], tick: Object.fromEntries(TARGETS.map((target) => [target.name, [] as number[]])) }
  let heapStart = 0
  for (let frame = 0; frame < WARMUP + FRAMES; frame++) {
    if (frame === WARMUP) heapStart = readHeapUsed() ?? 0
    const time = frame / FPS
    const t0 = performance.now()
    const { analyses: [features], hops } = feedSlots(slots, track, time, SAMPLE_RATE)
    const analysisMs = performance.now() - t0
    const feedMs = feedTargets(targets, slots, features)
    const previewMs = timePreview(targets, time, frame)
    timeTicks(name, targets, time, frame, times.tick)
    if (frame < WARMUP) continue
    times.analysis.push(analysisMs)
    times.perHop.push(hops > 0 ? analysisMs / hops : 0)
    times.feed.push(feedMs)
    times.renderPreview.push(previewMs)
  }
  return { ...times, slots, heapStart, heapEnd: readHeapUsed() }
}

/** Stages the 0.1 ms clock can't resolve per frame, one call's cost from a batch */
export function timeBatches(program: GlslProgram, targets: Targets, slots: Slot[]) {
  const [knob] = program.uniforms
  const [first] = targets.leds
  return {
    calls: BATCH,
    set: timeBatch(BATCH, () => knob && first.runtime.set(knob, 0.5)),
    feed: timeBatch(BATCH, () => first.renderer.setAudio(slots[0].textures, slots.slice(1).map((slot) => slot.textures), null)),
    tick: Object.fromEntries(TARGETS.map((target, i) => [target.name, timeBatch(BATCH, () => { targets.leds[i].runtime.tick({ time: 0, dt: 1 / FPS, frame: 0, ledCount: target.leds, scanY: 0.5 }) })])),
  }
}

function timeRepeats(run: () => void): number[] {
  const times: number[] = []
  for (let i = 0; i < WARMUP + COMPILES; i++) {
    const t0 = performance.now()
    run()
    if (i >= WARMUP) times.push(performance.now() - t0)
  }
  return times
}

/** Every renderer gets the audio; only the first one's upload is timed */
function feedTargets({ leds, preview }: Targets, slots: Slot[], features: Features | null): number {
  if (!features) return 0
  const extra = slots.slice(1).map((slot) => slot.textures)
  const t0 = performance.now()
  leds[0].renderer.setAudio(slots[0].textures, extra, features)
  const ms = performance.now() - t0
  for (const renderer of [...leds.slice(1).map((target) => target.renderer), preview]) renderer.setAudio(slots[0].textures, extra, features)
  return ms
}

function timePreview({ preview, finishPreview }: Targets, time: number, frame: number): number {
  const t0 = performance.now()
  preview.renderPreview({ time, dt: 1 / FPS, frame, ledCount: 60, scanY: 0.5 }, 0)
  // Preview never reads back, so nothing would be waited on w/o this
  finishPreview()
  return performance.now() - t0
}

/** Past TARGET_FRAMES only strip 60 keeps ticking */
function timeTicks(name: string, { leds }: Targets, time: number, frame: number, ticks: Record<string, number[]>) {
  TARGETS.forEach((target, i) => {
    const measured = frame >= WARMUP
    if (measured && frame >= WARMUP + TARGET_FRAMES && i > 0) return
    const t0 = performance.now()
    const colors = leds[i].runtime.tick({ time, dt: 1 / FPS, frame, ledCount: target.leds, scanY: 0.5 })
    const ms = performance.now() - t0
    if (measured) ticks[target.name].push(ms)
    if (frame === WARMUP) expect(colors.some(Number.isNaN), `${name}: NaN in the LED colors at ${target.name}`).toBe(false)
  })
}
