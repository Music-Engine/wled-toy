// The GLSL target: the pixel pass as the shader the renderer draws per pixel, and the frame pass as the shader that
// draws global state once per LED tick. A graph with no global state has no frame pass, and its pixel pass is exactly
// what the old pipeline emitted.
import type { OutputSettings } from '@/lib/engine/output/output'
import type { FrameSource } from '@/lib/engine/render/frame-pass'
import { PRELUDE_UNIFORMS } from '@/lib/shader/prelude'
import type { GlslChunk } from '@/lib/graph/define/context'
import { glslForm } from '@/lib/graph/compile/glsl/glsl-types'
import { stateLoads, stateTargets } from '@/lib/graph/compile/glsl/glsl-state'
import { resolveChunks } from '@/lib/graph/compile/glsl/glsl'
import type { CompileContext, ProgramUniform, Slots, Target } from '@/lib/graph/compile/next/context'
import { emitPass, type PassCode, type Spelling } from '@/lib/graph/compile/next/emit'

export const glsl = (): Target<GlslProgram> => ({
  name: 'glsl',
  reads: ['width', 'pass', 'state', 'resources'],
  emit: (ctx) => {
    const texels = vectorsReached(ctx.slots.global)
    const pixel = emitPixelShaderLines(ctx, emitPass(ctx, GLSL, 'pixel'), { globals: texels > 0 ? ['uniform highp sampler2D iGlobal;'] : [], beforeMain: [] })
    const frame = texels > 0 ? emitFrameShaderLines(emitPass(ctx, GLSL, 'frame'), texels) : []
    const probed = collectProbeOffsets(ctx)
    return {
      pixel: joinLines(pixel),
      frame: texels > 0 ? { code: joinLines(frame), texels, probes: Object.values(probed).map((offset) => Math.floor(offset / 4)) } : null,
      lineNodes: { pixel: [null, ...pixel.map((line) => line.node)], frame: [null, ...frame.map((line) => line.node)] },
      probes: probed,
      uniforms: ctx.uniforms,
      resources: ctx.resources,
      output: ctx.settings,
    }
  },
})

export interface GlslProgram {
  /** The shader drawn per pixel, `mainImage` as the prelude calls it. */
  pixel: string
  /** The whole shader drawn once per LED tick into global state, as `renderer.compile` takes it; null without global state. */
  frame: FrameSource | null
  /**
   * The node that emitted each line of each pass, by 1-based line number, null for the lines the target wrote: what a
   * driver error names. The frame pass reports its lines as GLSL source string 1, the pixel pass as 0.
   */
  lineNodes: { pixel: (string | null)[]; frame: (string | null)[] }
  /** The global state float each probe node's output is written to, by node id, in the order `frame.probes` lists their texels. */
  probes: Record<string, number>
  /** What the host writes into the prelude's `iControl` before each frame, in the order of their offsets. */
  uniforms: ProgramUniform[]
  /** What nodes registered while compiling, by kind. */
  resources: Record<string, unknown[]>
  /** Wire settings from the graph's Output node. */
  output: OutputSettings | null
}

// the frame pass keeps global state in a local array loaded from last tick's texture; the pixel pass samples the texture
const GLSL: Spelling = {
  form: glslForm,
  globalSlot: (offset, dim, pass) => `${pass === 'frame' ? `globalState[${Math.floor(offset / 4)}]` : `texelFetch(iGlobal, ivec2(${Math.floor(offset / 4)}, 0), 0)`}.${components(offset, dim)}`,
}

export const components = (offset: number, dim: number) => 'xyzw'.slice(offset % 4, (offset % 4) + dim)

/** Pixel state layers or global state texels a table reaches: a slot never straddles two, so its first float says which it is in. */
export function vectorsReached(table: Record<string, Slots>): number {
  const offsets = Object.values(table).flatMap((slots) => Object.values(slots).map((slot) => slot.offset))
  return offsets.reduce((count, offset) => Math.max(count, Math.floor(offset / 4) + 1), 0)
}

/** A line of shader text and the node it came from, null for the target's own lines. */
type Line = { text: string; node: string | null }

/** The shader text of `lines`, one per line, ending in a newline. */
const joinLines = (lines: Line[]) => [...lines.map((line) => line.text), ''].join('\n')
/** Lines of text the target writes itself, which no node emitted. */
const toLines = (texts: string[]): Line[] => texts.map((text) => ({ text, node: null }))

/**
 * The old pipeline's shader text: the state targets, `globals`, the chunks the prelude lacks, `beforeMain`, then mainImage
 * with every pixel line. The usermod target passes the frame pass as `beforeMain`, so both passes share one set of chunks.
 */
export function emitPixelShader(ctx: CompileContext, code: PassCode, extra: { chunks: Iterable<GlslChunk>; globals: string[]; beforeMain: string[] }): string {
  return joinLines(emitPixelShaderLines(ctx, { ...code, chunks: new Set(extra.chunks) }, extra))
}

function emitPixelShaderLines(ctx: CompileContext, code: PassCode, extra: { globals: string[]; beforeMain: string[] }): Line[] {
  const layers = vectorsReached(ctx.slots.pixel)
  const chunks = [...code.chunks].filter((chunk) => !chunk.inPrelude)
  const header = ['// Generated by WLEDtoy graph mode', ...stateTargets(layers), ...extra.globals, ...resolveChunkSource(chunks), ...extra.beforeMain, 'void mainImage(out vec4 c, vec2 uv, float ledIndex) {', '  c = vec4(0.0, 0.0, 0.0, 1.0);', ...stateLoads(layers)]
  return [...toLines(header), ...code.lines.map((l) => ({ text: `  ${l.text}`, node: l.node })), ...toLines(['}'])]
}

/** The GLSL source of `chunks` and what they require, each after a comment naming it. */
export const resolveChunkSource = (chunks: Iterable<GlslChunk>) => resolveChunks(chunks).flatMap((chunk) => [`// ${chunk.id}`, ...chunk.source.trim().split('\n'), ''])

/**
 * A whole fragment shader, one fragment per texel: it loads global state, runs the frame bodies, and writes its own
 * texel. Texels past the program's keep what they held, so the renderer can draw more than the program uses. Its lines
 * are source string 1, numbered as they stand, so a driver error tells it from the pixel pass.
 */
function emitFrameShaderLines(code: PassCode, texels: number): Line[] {
  return [
    ...toLines([
      '#version 300 es',
      '#line 3 1',
      '// Generated by WLEDtoy graph mode: frame pass',
      'precision highp float;',
      '',
      ...PRELUDE_UNIFORMS.split('\n'),
      'uniform highp sampler2D iGlobal;',
      'out vec4 outGlobal;',
      '',
      ...resolveChunkSource(code.chunks),
      'void main() {',
      '  int texel = int(gl_FragCoord.x);',
      `  vec4 globalState[${texels}];`,
      `  for (int i = 0; i < ${texels}; i++) globalState[i] = texelFetch(iGlobal, ivec2(i, 0), 0);`,
    ]),
    ...code.lines.map((l) => ({ text: `  ${l.text}`, node: l.node })),
    ...toLines([`  outGlobal = texel < ${texels} ? globalState[texel] : texelFetch(iGlobal, ivec2(texel, 0), 0);`, '}']),
  ]
}

function collectProbeOffsets(ctx: CompileContext): Record<string, number> {
  const probing = ctx.order.filter((id) => ctx.nodes[id].shape.probe)
  return Object.fromEntries(probing.map((id) => [id, ctx.nodes[id].exports![ctx.nodes[id].shape.probe!]]))
}
