// The GLSL backend: turns a Program's pixel entries into the shader, in the order the Program lists them. Bodies run only
// here, so what one declares through `ctx.require` is written back onto its Program node as plain data.
import type { OutputSettings } from '@/lib/engine/output'
import type { GlslChunk, NodeContext } from '@/lib/graph/define/context'
import type { NodeShape, Socket } from '@/lib/graph/define/shape'
import type { ImplicitDefault } from '@/lib/graph/define/types'
import { castTo, floatLiteral, vectorLiteral, vectorType, type Value } from '@/lib/graph/define/value'
import { stateLayers, stateLoads, stateSlots, stateTargets } from './glsl-state'
import { glslForm } from './glsl-types'
import { concreteType, GraphError, shapeOf, type GraphIssue, type PixelEntry, type PixelInput, type PixelSource, type Program, type ProgramNode } from './program'

/**
 * A node that fails here failed before anything the front end found after it, so its error wins over the Program's.
 * Issues keep the front end's first and the bodies' after them.
 */
export function glsl(program: Program): GlslShader {
  const e: Emission = { program, body: [], chunks: new Set(), values: new Map(), frozenValues: new Map(), issues: [...program.issues], frozen: [] }
  const { error, errorNode } = emitAll(e) ?? program
  return { ...assemble(e), output: program.output, issues: e.issues, frozen: e.frozen, error, errorNode }
}

export interface FrozenValue {
  nodeId: string
  title: string
  output: string
  value: string
}

export interface GlslShader {
  code: string
  /** Wire settings from the graph's Output node; null when it has none. */
  output: OutputSettings | null
  error: string | null
  errorNode: string | null
  issues: GraphIssue[]
  /** Node id that emitted each line of `code`, indexed by 1-based line number. */
  lineNodes: (string | null)[]
  /** Standalone only: per-frame values with no GLSL of their own, written into the code as the number they had. */
  frozen: FrozenValue[]
}

interface Emission {
  program: Program
  body: { text: string; node: string }[]
  chunks: Set<GlslChunk>
  /** What each emitted node and each frozen output put out, by node id and by `id:output`. */
  values: Map<string, Record<string, Value>>
  frozenValues: Map<string, Value>
  issues: GraphIssue[]
  frozen: FrozenValue[]
}

function emitAll(e: Emission): { error: string; errorNode: string | null } | undefined {
  try {
    for (const entry of e.program.pixel) emitEntry(e, entry)
  } catch (err) {
    return { error: (err as Error).message, errorNode: err instanceof GraphError ? err.nodeId : null }
  }
}

function emitEntry(e: Emission, entry: PixelEntry): void {
  if ('frozen' in entry) return freeze(e, entry.frozen, entry.output, entry.value)
  const node = e.program.nodes[entry.node]
  const shape = shapeOf(node)
  const input: Record<string, unknown> = {}
  for (const socket of shape.inputs) input[socket.name] = bodyInput(e, node, shape, socket, entry.inputs[socket.name])
  shape.includes.forEach((chunk) => e.chunks.add(chunk))
  e.values.set(node.id, shape.pixel!(input, context(e, node, shape)))
}

function bodyInput(e: Emission, node: ProgramNode, shape: NodeShape, socket: Socket, input: PixelInput): unknown {
  if ('value' in input) return input.value
  // the front end gives only linkable value sockets a source to cast
  const value = sourceValue(e, socket, input.from)
  try {
    return castTo(glslForm(socket.type).cast(value), input.cast)
  } catch (err) {
    throw new GraphError(`${shape.title}: ${(err as Error).message}`, node.id)
  }
}

function sourceValue(e: Emission, socket: Socket, from: PixelSource): Value {
  if ('link' in from) return linkedOutput(e, from.link, from.output)
  if ('uniform' in from) return uniformRead(from.uniform, from.dim)
  if ('frozen' in from) return e.frozenValues.get(`${from.frozen}:${from.output}`)!
  if ('standalone' in from) return standaloneOutput(e.program.nodes[from.standalone], from.output)
  if ('implicit' in from) return implicitValue(socket)
  return glslForm(socket.type).literal(from.literal)
}

/** Every body returns every numeric output it declares; one that does not is a bug in that node. */
function linkedOutput(e: Emission, id: string, output: string): Value {
  const value = e.values.get(id)![output]
  if (!value) throw new GraphError(`${shapeOf(e.program.nodes[id]).title} did not produce "${output}"`, id)
  return value
}

function uniformRead(slot: number, dim: number): Value {
  const reads = Array.from({ length: dim }, (_, i) => `iControl[${Math.floor((slot + i) / 4)}].${'xyzw'[(slot + i) % 4]}`)
  return { expr: dim === 1 ? reads[0] : `${vectorType(dim)}(${reads.join(', ')})`, type: vectorType(dim) }
}

/** The front end only points here for a numeric output with a stand-in. */
function standaloneOutput(node: ProgramNode, output: string): Value {
  const { type } = shapeOf(node).outputs.find((o) => o.name === output)!
  return { expr: standaloneExpr(node.kind, output)!, type: concreteType(glslForm(type).type) }
}

/** The front end only points here for a linkable socket that falls back to its implicit expression. */
function implicitValue(socket: Socket): Value {
  const { expr } = socket.default as ImplicitDefault
  return { expr, type: concreteType(glslForm(socket.type).type) }
}

function freeze(e: Emission, id: string, output: string, value: number | number[]): void {
  const shape = shapeOf(e.program.nodes[id])
  const out = shape.outputs.find((o) => o.name === output)!
  const baked = Array.isArray(value) ? vectorLiteral(value) : floatLiteral(value)
  e.body.push({ node: id, text: `// ${shape.title} "${out.label}" runs per frame; frozen at ${baked.expr} when this code was taken` })
  e.frozen.push({ nodeId: id, title: shape.title, output: out.label, value: baked.expr })
  e.frozenValues.set(`${id}:${output}`, baked)
}

function context(e: Emission, node: ProgramNode, shape: NodeShape): NodeContext {
  const { id: nodeId, width, resolved } = node
  const base = `n_${nodeId.replace(/\W/g, '_')}`
  const variable = (suffix?: string) => (suffix ? `${base}_${suffix}` : base)
  const emit = (text: string) => e.body.push({ text, node: nodeId })
  return {
    nodeId, resolved, variable, emit,
    gen: width!,
    state: stateSlots(e.program.state[nodeId], shape),
    declare: (type, expr, suffix) => {
      emit(`${type} ${variable(suffix)} = ${expr};`)
      return { expr: variable(suffix), type }
    },
    call: (fn, args, outs) => {
      const results = Object.entries(outs).map(([name, type]) => [name, { expr: variable(name), type }] as const)
      emit(`${results.map(([, out]) => `${out.type} ${out.expr};`).join(' ')} ${fn}(${[...args, ...results.map(([, out]) => out.expr)].join(', ')});`)
      return Object.fromEntries(results) as never
    },
    include: (chunk) => e.chunks.add(chunk),
    issue: (message) => e.issues.push({ nodeId, message }),
    // 'glsl' is the only requirement there is, so a repeated call leaves the same one entry
    require: (target) => (node.requires = [target]),
  }
}

/**
 * The shader text: the state targets it writes, the chunks the graph used, then mainImage with every emitted line.
 * Returns the node behind each line too.
 */
function assemble(e: Emission): { code: string; lineNodes: (string | null)[] } {
  const library = resolveChunks(e.chunks).flatMap((chunk) => [`// ${chunk.id}`, ...chunk.source.trim().split('\n'), ''])
  const layers = stateLayers(e.program)
  const header = ['// Generated by WLEDtoy graph mode', ...stateTargets(layers), ...library, 'void mainImage(out vec4 c, vec2 uv, float ledIndex) {', '  c = vec4(0.0, 0.0, 0.0, 1.0);', ...stateLoads(layers)]
  return {
    code: [...header, ...e.body.map((l) => `  ${l.text}`), '}', ''].join('\n'),
    lineNodes: [null, ...header.map(() => null), ...e.body.map((l) => l.node), null],
  }
}

/** `chunks` and everything they require, each once, dependencies first. */
function resolveChunks(chunks: Iterable<GlslChunk>): GlslChunk[] {
  const ordered: GlslChunk[] = []
  const seen = new Set<GlslChunk>()
  const visit = (chunk: GlslChunk) => {
    if (seen.has(chunk)) return
    seen.add(chunk)
    chunk.requires.forEach(visit)
    ordered.push(chunk)
  }
  for (const chunk of chunks) visit(chunk)
  return ordered
}

/** Exported or sent to shader mode there is no analyzer and no uniform block, so what the prelude's audio helpers give stands in. */
const STANDALONE: Record<string, Record<string, string>> = {
  audio: { level: 'energy()', kick: 'bass()', sub: 'bass()', lowMid: 'mid()', vocal: 'mid()', presence: 'treble()', air: 'treble()', beat: 'beat(0.5)' },
  audioSignal: { signal: 'energy()' },
}

/** What stands in for a per-frame output of a node of `kind` in standalone code; without one the output is frozen. */
export const standaloneExpr = (kind: string, output: string): string | undefined => STANDALONE[kind]?.[output]
