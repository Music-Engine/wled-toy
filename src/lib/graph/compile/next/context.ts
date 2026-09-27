// What the stages of a compile share: the nodes in topo order with what each annotation settled on them, the issues,
// and the stage contracts createCompiler checks. Everything a target returns is plain data; this context is not.
import type { OutputSettings } from '@/lib/engine/output/output'
import type { ResolveResult } from '@/lib/graph/define/context'
import type { NodeShape } from '@/lib/graph/define/shape'
import type { NodeGraph } from '@/lib/graph/model/doc'
import type { GraphIssue } from '@/lib/graph/compile/front-end/program'

/** Which function a node is emitted into: once per frame into global state, or once per pixel. */
export type Pass = 'frame' | 'pixel'

export interface CompileContext {
  doc: NodeGraph
  /** Every node the sinks reach, each after the nodes it reads. */
  order: string[]
  nodes: Record<string, CompiledNode>
  /** The Output node, whose color the LEDs show. */
  output: string
  /** What `resolve` registered, by kind, in topo order. */
  resources: Record<string, unknown[]>
  /** The Output node's wire settings. */
  settings: OutputSettings | null
  /** The table the previous compile returned; `state` reads it and fills `slots`. */
  previous: SlotTable
  slots: SlotTable
  issues: GraphIssue[]
}

export interface CompiledNode {
  id: string
  kind: string
  values: Record<string, unknown>
  shape: NodeShape
  /** The source of each linked input, muted nodes passed through; an input without a link is absent. */
  links: Record<string, LinkSource>
  /** By `width`: the component count generic sockets resolve to. */
  width?: number
  /** By `pass`. */
  pass?: Pass
  /** By `state`: the first float of each declared slot, in pixel or global state after the node's pass. */
  state?: Record<string, number>
  /** By `state`: the global state float each output the other pass or the host reads is written to. */
  exports?: Record<string, number>
  /** By `resources`: what `resolve` returned, and what arrives on each stream input. */
  resolved?: ResolveResult
  streams?: Record<string, unknown>
}

export type LinkSource = { id: string; output: string }

/**
 * Where each node's slots sit, kept across compiles so state survives an edit. Pixel state is keyed by node id; global
 * state by node id for declared slots and by `id:output` for an exported output.
 */
export interface SlotTable {
  pixel: Record<string, Slots>
  global: Record<string, Slots>
}

/** Slot name to its type id and first float. */
export type Slots = Record<string, { type: string; offset: number }>

export const emptySlots = (): SlotTable => ({ pixel: {}, global: {} })

/** Settles one fact per node; `reads` names the annotations whose facts it needs, which must come before it. */
export interface Annotation {
  name: string
  reads: string[]
  annotate(ctx: CompileContext): void
}

/** Reports what makes a program unrunnable; any issue it returns withholds the program. */
export interface Check {
  name: string
  reads: string[]
  check(ctx: CompileContext): GraphIssue[]
}

/** Emits the program for one language from the annotated context. */
export interface Target<P> {
  name: string
  reads: string[]
  emit(ctx: CompileContext): P
}

export type Stage = 'lint' | 'topo' | 'annotations' | 'checks' | 'optimize' | 'target'

/** Observes the context after a stage; it must not change it. */
export type Hook = (stage: Stage, ctx: CompileContext) => void
