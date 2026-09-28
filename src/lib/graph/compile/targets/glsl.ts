import type { OutputSettings } from '@/lib/engine/output/output'
import type { FrameSource } from '@/lib/engine/render/frame-pass'
import { PRELUDE_UNIFORMS } from '@/lib/shader/prelude'
import type { GlslChunk } from '@/lib/graph/define/context'
import { floatLiteral } from '@/lib/graph/define/value'
import type { CompileContext, PassCode, ProgramUniform, Slots, Target } from '@/lib/graph/compile/context'
import { emitPass, orderChunks, type Spelling } from '@/lib/graph/compile/emit'
import { toGlslForm } from './glsl-form'

/** Pixel pass drawn per pixel, frame pass once per LED tick; standalone, both in one mainImage needing no host */
export const createGlslTarget = ({ standalone = false } = {}): Target<GlslProgram> => ({
  name: 'glsl',
  reads: ['width', 'pass', 'state', 'resources'],
  emit: (ctx) => (standalone ? emitStandalone(ctx) : emitLive(ctx)),
})

export interface GlslProgram {
  /** `mainImage` as the prelude calls it */
  pixel: string
  /** Whole shader as `renderer.compile` takes it; null w/o global state */
  frame: FrameSource | null
  /** Node behind each 1-based line, null for target lines: what a driver error names */
  lineNodes: { pixel: (string | null)[]; frame: (string | null)[] }
  /** Global state float of each probe output, by node id, in `frame.probes` order */
  probes: Record<string, number>
  /** What the host writes into `iControl` before each frame, by offset */
  uniforms: ProgramUniform[]
  resources: Record<string, unknown[]>
  output: OutputSettings | null
}

/** GLSL source string number of the frame pass in driver errors; the pixel pass is 0 */
export const FRAME_SOURCE_STRING = 1

// Frame pass keeps global state in a local array loaded from last tick; pixel pass samples the texture
const GLSL: Spelling = {
  toForm: toGlslForm,
  toGlobalSlot: (offset, dim, pass) => `${pass === 'frame' ? `globalState[${Math.floor(offset / 4)}]` : `texelFetch(iGlobal, ivec2(${Math.floor(offset / 4)}, 0), 0)`}.${toComponents(offset, dim)}`,
  toUniform: ({ offset }) => `iControl[${Math.floor(offset / 4)}].${'xyzw'[offset % 4]}`,
}

function emitLive(ctx: CompileContext): GlslProgram {
  const texels = countVectors(ctx.slots.global)
  const layers = countVectors(ctx.slots.pixel)
  const code = emitPass(ctx, GLSL, 'pixel')
  const pixel = emitPixelShaderLines(code, { chunks: toChunks(code), globals: [...declareStateTargets(layers), ...(texels > 0 ? ['uniform highp sampler2D iGlobal;'] : [])], beforeMain: [], locals: loadStateLayers(layers) })
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
}

/** Both passes as one mainImage in topo order, state zeroed on every pixel of every frame */
function emitStandalone(ctx: CompileContext): GlslProgram {
  reportLostHost(ctx)
  const layers = countVectors(ctx.slots.pixel)
  const { offsets, texels } = packFrameState(ctx)
  // Frame outputs are plain locals, only frame state takes the `state` array; a uniform is its default
  const spelling: Spelling = {
    toForm: toGlslForm,
    toGlobalSlot: (offset, dim) => `state[${Math.floor(offsets.get(offset)! / 4)}].${toComponents(offsets.get(offset)!, dim)}`,
    toUniform: (uniform) => floatLiteral(uniform.default).expr,
  }
  const code = emitPass(ctx, spelling, 'both')
  const locals = [
    ...Array.from({ length: layers }, (_, i) => `  vec4 outState${i + 1} = vec4(0.0);`),
    ...(texels > 0 ? [`  vec4 state[${texels}];`, `  for (int i = 0; i < ${texels}; i++) state[i] = vec4(0.0);`] : []),
  ]
  const pixel = emitPixelShaderLines(code, { chunks: toChunks(code), globals: [], beforeMain: [], locals })
  return { pixel: joinLines(pixel), frame: null, lineNodes: { pixel: [null, ...pixel.map((line) => line.node)], frame: [] }, probes: {}, uniforms: [], resources: ctx.resources, output: ctx.settings }
}

/** Exported shader has no host: stateful nodes forget, uniforms hold defaults */
function reportLostHost(ctx: CompileContext): void {
  for (const id of ctx.order.filter((id) => ctx.nodes[id].shape.state)) {
    ctx.issues.push({ nodeId: id, message: `${ctx.nodes[id].shape.title} keeps no memory in the exported shader: its state starts from 0 on every pixel of every frame` })
  }
  for (const uniform of ctx.uniforms) {
    const { shape } = ctx.nodes[uniform.node]
    const label = shape.outputs.find((output) => output.name === uniform.output)!.label
    ctx.issues.push({ nodeId: uniform.node, message: `${shape.title} "${label}" is fixed at ${uniform.default} in the exported shader` })
  }
}

/** Frame state slots repacked from their global offsets, in topo order, a vector never straddling texels */
function packFrameState(ctx: CompileContext): { offsets: Map<number, number>; texels: number } {
  const offsets = new Map<number, number>()
  let next = 0
  for (const id of ctx.order.filter((id) => ctx.nodes[id].pass === 'frame')) {
    for (const slot of Object.values(ctx.slots.global[id] ?? {})) {
      const start = (next % 4) + slot.dim > 4 ? Math.ceil(next / 4) * 4 : next
      offsets.set(slot.offset, start)
      next = start + slot.dim
    }
  }
  return { offsets, texels: Math.ceil(next / 4) }
}

interface ShaderParts {
  /** Prelude chunks are skipped */
  chunks: Iterable<GlslChunk>
  globals: string[]
  beforeMain: string[]
  /** First lines of mainImage, after color starts black */
  locals: string[]
}

export function emitPixelShaderLines(code: Pick<PassCode, 'lines'>, parts: ShaderParts): Line[] {
  const chunks = [...parts.chunks].filter((chunk) => !chunk.inPrelude)
  const header = ['// Generated by WLEDtoy graph mode', ...parts.globals, ...toChunkSource(chunks), ...parts.beforeMain, 'void mainImage(out vec4 c, vec2 uv, float ledIndex) {', '  c = vec4(0.0, 0.0, 0.0, 1.0);', ...parts.locals]
  return [...toLines(header), ...code.lines.map((line) => ({ text: `  ${line.text}`, node: line.node })), ...toLines(['}'])]
}

/** One fragment per texel; texels past the program's keep their values, so the renderer may draw more */
function emitFrameShaderLines(code: PassCode, texels: number): Line[] {
  return [
    ...toLines([
      '#version 300 es',
      `#line 3 ${FRAME_SOURCE_STRING}`,
      '// Generated by WLEDtoy graph mode: frame pass',
      'precision highp float;',
      '',
      ...PRELUDE_UNIFORMS.split('\n'),
      'uniform highp sampler2D iGlobal;',
      'out vec4 outGlobal;',
      '',
      ...toChunkSource(toChunks(code)),
      'void main() {',
      '  int texel = int(gl_FragCoord.x);',
      `  vec4 globalState[${texels}];`,
      `  for (int i = 0; i < ${texels}; i++) globalState[i] = texelFetch(iGlobal, ivec2(i, 0), 0);`,
    ]),
    ...code.lines.map((line) => ({ text: `  ${line.text}`, node: line.node })),
    ...toLines([`  outGlobal = texel < ${texels} ? globalState[texel] : texelFetch(iGlobal, ivec2(texel, 0), 0);`, '}']),
  ]
}

/** Probes fed per pixel have no export and are left out */
function collectProbeOffsets(ctx: CompileContext): Record<string, number> {
  const probing = ctx.order.filter((id) => ctx.nodes[id].shape.probe && ctx.nodes[id].exports?.[ctx.nodes[id].shape.probe!] !== undefined)
  return Object.fromEntries(probing.map((id) => [id, ctx.nodes[id].exports![ctx.nodes[id].shape.probe!]]))
}

// iState declared here, not in prelude: a host w/o the prev state array must read 0, which the bundle can't promise
export function declareStateTargets(layers: number): string[] {
  if (layers === 0) return []
  return ['uniform highp sampler2DArray iState;', ...Array.from({ length: layers }, (_, i) => `layout(location = ${i + 1}) out vec4 outState${i + 1};`), '']
}

// Every layer starts as last frame's, so an unassigned slot and its padding keep their values
export const loadStateLayers = (layers: number) => Array.from({ length: layers }, (_, i) => `  outState${i + 1} = texelFetch(iState, ivec3(gl_FragCoord.xy, ${i}), 0);`)

/** Pixel layers or global texels a table reaches; a slot's first float says which one it sits in */
export function countVectors(table: Record<string, Slots>): number {
  const offsets = Object.values(table).flatMap((slots) => Object.values(slots).map((slot) => slot.offset))
  return offsets.reduce((count, offset) => Math.max(count, Math.floor(offset / 4) + 1), 0)
}

export const toChunks = (code: Pick<PassCode, 'includes'>) => code.includes.map((include) => include.chunk)

const toChunkSource = (chunks: Iterable<GlslChunk>) => orderChunks(chunks).flatMap((chunk) => [`// ${chunk.id}`, ...chunk.source.trim().split('\n'), ''])

export const toComponents = (offset: number, dim: number) => 'xyzw'.slice(offset % 4, (offset % 4) + dim)

/** Shader line and its node, null for target lines */
type Line = { text: string; node: string | null }

export const joinLines = (lines: Line[]) => [...lines.map((line) => line.text), ''].join('\n')

const toLines = (texts: string[]): Line[] => texts.map((text) => ({ text, node: null }))

