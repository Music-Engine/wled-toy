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

export interface NodeContext {
  nodeId: string
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
  /** For the Output node: how the finished colors are processed and sent. The first Output in a graph decides. */
  output(settings: OutputSettings): void
}

export interface ResolveEnv {
  /**
   * Registers something the engine has to provide for this graph (an audio source, an analysis) and returns its index.
   * Equal configs share one index.
   */
  intern(kind: string, config: unknown): number
  issue(message: string): void
}
