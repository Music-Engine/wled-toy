// The Program: what the front end decided about a graph, as plain data, and all the backends read. It holds no
// functions and no class instances; a node's bodies and socket types resolve through the registry at build version.
import type { OutputSettings } from '@/lib/engine/output'
import type { GlslType } from '@/lib/shader/glsl'
import type { FrameValue } from '@/lib/graph/define/context'
import type { NodeShape } from '@/lib/graph/define/shape'
import { nodeItem } from '@/lib/graph/registry'
import type { FrameStep } from '@/lib/graph/compile/js/frame'

export interface GraphIssue {
  nodeId: string | null
  message: string
}

export class GraphError extends Error {
  constructor(message: string, readonly nodeId: string) {
    super(message)
  }
}

/**
 * `pixel` lists what the shader emits and `frame` what runs once per frame, each in the order the sinks reach it. A node
 * can sit in both lists: Time feeding an Integrator and a shader node is planned per frame and emitted per pixel.
 * Settling each node on one placement would change which nodes are evaluated, so it is left to a later decision.
 */
export interface Program {
  nodes: Record<string, ProgramNode>
  pixel: PixelEntry[]
  frame: ProgramStep[]
  /** Frame step outputs the shader reads, and where in the uniform block they go. */
  uniforms: UniformSlot[]
  /** The state each planned stateful node declares, by node id. */
  state: Record<string, ProgramState>
  /** What nodes registered while compiling, by kind: the audio source the graph wants, the analyses it reads. */
  resources: Record<string, unknown[]>
  /** Wire settings from the graph's Output node; null when it has none. */
  output: OutputSettings | null
  issues: GraphIssue[]
  /** Where the front end stopped; the entries before it are still built, as far as it got. */
  error: string | null
  errorNode: string | null
}

export interface ProgramNode {
  id: string
  kind: string
  values: Record<string, unknown>
  /** The `data` its `resolve` returned, for the bodies. */
  resolved: Record<string, unknown>
  /** The type generic sockets resolved to; null for a node the width pass never reached (a frozen output's source). */
  width: GlslType | null
  /** What the pixel body declared through `ctx.require`; the GLSL backend records it as it runs the body, absent when nothing. */
  requires?: 'glsl'[]
}

/**
 * Slot name to type id, not the type: the Program stays plain data, and a backend that needs more than the id (an Enum's
 * first option) reads the declaration at build version, as it reads the bodies.
 */
export type ProgramState = { slots: Record<string, string> } & (
  | { scope: 'frame' }
  | {
    scope: 'pixel'
    /** The state float each slot starts at: float k is component k % 4 of `outState<k / 4 + 1>`. */
    offsets: Record<string, number>
  }
)

type ProgramStep = Omit<FrameStep, 'kind' | 'frame' | 'state' | 'resolved'>

interface UniformSlot {
  step: number
  output: string
  slot: number
  dim: number
}

/** A node the shader emits, or a per-frame output frozen into the code (standalone), at the point it is first read. */
export type PixelEntry = { node: string; inputs: Record<string, PixelInput> } | { frozen: string; output: string; value: FrameValue }

/** A stream or stored value is handed to the body as is; anything linkable is cast to `cast` first. */
export type PixelInput = { value: unknown } | { from: PixelSource; cast: GlslType }

export type PixelSource =
  | { link: string; output: string }
  | { uniform: number; dim: number }
  | { frozen: string; output: string }
  | { standalone: string; output: string }
  | { implicit: true }
  | { literal: unknown }

/** The node's shape at build version; the front end already refused an unknown kind. */
export function nodeShape(node: ProgramNode): NodeShape {
  const item = nodeItem(node.kind)
  if (!item) throw new GraphError(`Unknown node type "${node.kind}"`, node.id)
  return item.shape(node.values)
}

/** A socket type as a value of it is declared: an unresolved generic is a float. */
export const concreteType = (glsl: GlslType): GlslType => (glsl === 'genType' ? 'float' : glsl)
