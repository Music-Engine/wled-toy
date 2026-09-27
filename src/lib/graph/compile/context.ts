import type { OutputSettings } from '@/lib/engine/output/output'
import type { GlslChunk, ResolveResult, Uniform } from '@/lib/graph/define/context'
import type { NodeShape } from '@/lib/graph/define/shape'
import type { NodeGraph } from '@/lib/graph/model/doc'

export interface GraphIssue {
  nodeId: string | null
  message: string
}

/** Stops a compile; becomes the last issue */
export class GraphError extends Error {
  constructor(message: string, readonly nodeId: string) {
    super(message)
  }
}

/** Once per frame into global state, or once per pixel */
export type Pass = 'frame' | 'pixel'

export interface CompileContext {
  doc: NodeGraph
  /** Every node the sinks reach, each after what it reads */
  order: string[]
  nodes: Record<string, CompiledNode>
  /** Output node whose color the LEDs show */
  output: string
  /** What `resolve` registered, by kind, in topo order */
  resources: Record<string, unknown[]>
  settings: OutputSettings | null
  /** By `resources`: every output a uniform feeds, in topo order */
  uniforms: ProgramUniform[]
  /** Table from prev compile; `state` reads it and fills `slots` */
  previous: SlotTable
  slots: SlotTable
  issues: GraphIssue[]
  /** By `cppParity`: each pass emitted once w/ the C++ spelling, for the usermod target */
  cpp?: Record<Pass, PassCode>
}

export interface CompiledNode {
  id: string
  kind: string
  values: Record<string, unknown>
  shape: NodeShape
  /** Source of each linked input, muted nodes passed through */
  links: Record<string, LinkSource>
  /** By `width` */
  width?: number
  /** By `pass` */
  pass?: Pass
  /** By `state`: first float of each declared slot */
  state?: Record<string, number>
  /** By `state`: global state float of each output the other pass or host reads */
  exports?: Record<string, number>
  /** By `resources` */
  resolved?: ResolveResult
  streams?: Record<string, unknown>
  /** By `cppParity` */
  cppParity?: boolean
}

export type LinkSource = { id: string; output: string }

/** Float of `iControl` a node output reads */
export type ProgramUniform = Uniform & { node: string; output: string; offset: number }

/** Kept across compiles so state survives an edit; global keys are node ids and `id:output` for exports */
export interface SlotTable {
  pixel: Record<string, Slots>
  global: Record<string, Slots>
}

export type Slots = Record<string, { type: string; dim: number; offset: number; kind: string }>

export const createSlotTable = (): SlotTable => ({ pixel: {}, global: {} })

/** One pass's emitted lines and the chunks each node included, in include order */
export interface PassCode {
  lines: { text: string; node: string }[]
  includes: { chunk: GlslChunk; node: string }[]
}

/** Settles one fact per node; `reads` must be listed before it */
export interface Annotation {
  name: string
  reads: string[]
  annotate(ctx: CompileContext): void
}

/** Reports what makes a program unrunnable; an issue withholds the program unless `withholds` is false */
export interface Check {
  name: string
  reads: string[]
  withholds?: false
  check(ctx: CompileContext): GraphIssue[]
}

export interface Target<P> {
  name: string
  reads: string[]
  emit(ctx: CompileContext): P
}

export type Stage = 'lint' | 'topo' | 'annotations' | 'checks' | 'optimize' | 'target'

/** Observes context after a stage, never changes it */
export type Hook = (stage: Stage, ctx: CompileContext) => void
