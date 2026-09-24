import type { GlslType } from '@/lib/shader/glsl'
import type { Features } from '@/lib/audio/dsp'
import type { MidiReader } from '@/lib/engine/midi'
import type { OutputSettings } from '@/lib/engine/output'
import type { Value } from './value'

/**
 * A block of GLSL functions a node needs. The compiler emits each chunk a graph uses once, after the
 * chunks it requires, so nodes never paste helpers inline and two nodes can share one.
 */
export interface GlslChunk {
  id: string
  requires: GlslChunk[]
  source: string
}

/** What a frame body computes with: plain numbers, one evaluation per frame. */
export type FrameValue = number | number[]

export interface FrameInfo {
  /** Seconds since the engine clock was reset. */
  time: number
  /** Seconds since the previous frame step, capped so a hidden tab does not produce one huge step. */
  dt: number
  frameIndex: number
  /** The latest audio analysis; absent until audio has been analyzed. */
  /** Audio analyses by slot (0 is the default FFT); an entry is null until its first hop. */
  audio?: { analyses: (Features | null)[]; sampleRate: number }
  midi?: MidiReader
  /** Numeric arguments of the latest OSC message sent to an address. */
  osc?: (address: string) => number[] | undefined
}

/** What a frame body gets beside its inputs: the frame, the node's state, and what its `resolve` returned. */
export interface FrameContext<S = any> extends FrameInfo {
  state: S
  resolved: Record<string, unknown>
}

export interface NodeContext<S = Record<string, Value>> {
  nodeId: string
  /**
   * A pixel-scope node's slots, each a GLSL lvalue holding the value the slot had last frame until the body assigns
   * it: read it as any value, write it with `emit`.
   */
  state: S
  /** What the node's `resolve` returned. */
  resolved: Record<string, unknown>
  /** The type this node's generic sockets resolved to. */
  gen: GlslType
  /** A variable name unique to this node, stable across compiles so unchanged graphs produce unchanged code. */
  variable(suffix?: string): string
  emit(line: string): void
  /** Emits `type name = expr;` and returns the variable as a value. */
  declare(type: GlslType, expr: string, suffix?: string): Value
  /** Pulls a GLSL chunk into the shader; for helpers that depend on the node's resolved types, unlike `includes`. */
  include(chunk: GlslChunk): void
  /** Calls a GLSL function that returns through `out` parameters, declared here and listed last in the call. */
  call<O extends Record<string, GlslType>>(fn: string, args: string[], outs: O): { [K in keyof O]: Value }
  issue(message: string): void
  /**
   * Says the body's GLSL uses something outside the C-family subset (a texture sampler, a derivative), so a C++ build
   * leaves the node out. Emits nothing.
   */
  require(target: 'glsl'): void
}

/** Something the engine provides for a graph: an audio source, an analysis, an image layer, an OSC port. */
export interface Requirement {
  kind: string
  config: unknown
}

/** What a node's `resolve` settles while the graph compiles. The front end registers `requires` and reports `issues` on the node. */
export interface ResolveResult {
  /** What each stream output carries. */
  streams?: Record<string, unknown>
  /** Handed to the bodies as `resolved`, never merged into their inputs. */
  data?: Record<string, unknown>
  requires?: Requirement[]
  issues?: string[]
  /** The Output node's wire settings: how the finished colors are processed and sent. */
  output?: OutputSettings
}

/** What the nodes resolved before this one registered, by kind, in the order the front end met them. */
export type Resources = Readonly<Record<string, readonly unknown[] | undefined>>

/**
 * The index `config` has among the registered configs of `kind`, or the one registering it gives: equal configs share
 * one. The front end registers with it, so a node that needs its index before then computes the same one.
 */
export function resourceIndex(resources: Resources, kind: string, config: unknown): number {
  const list = resources[kind] ?? []
  const key = JSON.stringify(config)
  const index = list.findIndex((other) => JSON.stringify(other) === key)
  return index >= 0 ? index : list.length
}
