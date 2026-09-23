// The shapes of the node API: what a node definition declares, what a defined node is, and what its code receives.
// No logic lives here; defineNode (./define) builds these, sockets (./sockets) inspects them.
import type { CategoryId, GlslType } from '@/lib/shader/glsl'
import type { Features } from '@/lib/audio/dsp'
import type { MidiReader } from '@/lib/engine/midi'
import type { OutputSettings } from '@/lib/engine/output'
import type { GlslChunk } from '@/lib/graph/compile/glsl/chunk'
import type { DataType, GlslTypeDef, ImplicitDefault, LinkType, StreamType } from './types'
import type { Value } from './value'

export type WidgetProps = Record<string, unknown> | ((values: Record<string, unknown>) => Record<string, unknown>)

interface SocketOptions {
  /** Shown next to the socket; an empty string hides the label. Defaults to the socket name in Title Case. */
  label?: string
  /** Extra props for the widget that edits this socket while it is unlinked; a function when they depend on the node's other values. */
  props?: WidgetProps
}

/** An input that can be linked. Unlinked, it uses `default`: a literal the user can edit or an implicit expression. */
export type LinkedInputDef = SocketOptions & { type: GlslTypeDef<any>; connectable?: true; default?: unknown | ImplicitDefault }
/** An input that only lives on the node: `exec` receives the stored value instead of a GLSL expression. */
export type StoredInputDef = SocketOptions & { type: DataType<any>; connectable: false; default?: unknown }
/** An input linked to a stream; the node receives what `resolve` of the linked node produced, or null when unlinked. */
export type StreamInputDef = SocketOptions & { type: StreamType<any> }
export type InputDef = LinkType | LinkedInputDef | StoredInputDef | StreamInputDef
export type OutputDef = LinkType | { type: LinkType; label?: string }

type StreamOf<S> = S extends { type: StreamType<infer T> } ? T | null : S extends StreamType<infer T> ? T | null : never
type InputOf<S> = [StreamOf<S>] extends [never] ? (S extends { connectable: false; type: DataType<infer T> } ? T : Value) : StreamOf<S>
export type InputsOf<I> = { [K in keyof I]: InputOf<I[K]> }
export type OutputsOf<O> = { [K in keyof O]: Value }

/** What a control-rate node computes with: plain numbers, one evaluation per frame. */
export type FrameValue = number | number[]
type ControlOf<T> = [T] extends [number] ? number : [T] extends [number[]] ? number[] : FrameValue
type ControlInputOf<S> = [StreamOf<S>] extends [never] ? NumericControlInputOf<S> : StreamOf<S>
type NumericControlInputOf<S> = S extends { connectable: false; type: DataType<infer T> } ? T
  : S extends { type: GlslTypeDef<infer T> } ? ControlOf<T>
    : S extends GlslTypeDef<infer T> ? ControlOf<T> : FrameValue
export type ControlInputsOf<I> = { [K in keyof I]: ControlInputOf<I[K]> }
export type ControlOutputsOf<O> = { [K in keyof O]: FrameValue }

export interface FrameInfo {
  /** Seconds since the engine clock was reset. */
  time: number
  /** Seconds since the previous control step, capped so a hidden tab does not produce one huge step. */
  dt: number
  frameIndex: number
  /** The latest audio analysis; absent while no audio has run. */
  /** Audio analyses by slot (0 is the default FFT); an entry is null until its first hop. */
  audio?: { analyses: (Features | null)[]; sampleRate: number }
  midi?: MidiReader
  /** Numeric arguments of the latest OSC message sent to an address. */
  osc?: (address: string) => number[] | undefined
}

export interface NodeContext {
  nodeId: string
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

export interface NodeItemOptions<I extends Record<string, InputDef>, O extends Record<string, OutputDef>, S = undefined> {
  title: string
  description: string
  category: CategoryId
  /** GLSL shown in the menu preview. */
  signature?: string
  /** Codegen starts from output nodes. */
  isOutput?: boolean
  /** GLSL this node's code calls into. */
  includes?: GlslChunk[]
  /**
   * For a per-frame node: GLSL for an output when the graph is compiled standalone (sent to shader mode or exported),
   * where nothing feeds the uniform block. Outputs without one are baked from their last value.
   */
  standalone?: Partial<Record<keyof O, string>>
  input: I
  output: O
  /** Per pixel: emits GLSL. A node with only `exec` runs in the shader. */
  exec?(input: InputsOf<I>, ctx: NodeContext): OutputsOf<O>
  /**
   * Once per frame, on the CPU. A node with only `run` is control-rate: it can hold `state`, and its inputs must not vary
   * per pixel. A node with both runs on the CPU whenever everything linked into it does, and in the shader otherwise.
   */
  run?(input: ControlInputsOf<I>, state: S, frame: FrameInfo): ControlOutputsOf<O>
  /**
   * While the graph compiles: what this node puts on its stream outputs (Audio, Spectrum), from its stored values and
   * the streams linked into it. Anything else it returns is handed to `exec` and `run` alongside their inputs.
   */
  resolve?(input: InputsOf<I>, env: ResolveEnv): Record<string, unknown>
  /** Fresh state for a control-rate node. It survives recompiles for as long as the node exists. */
  state?(): S
}

export interface InputSocket {
  name: string
  label: string
  type: DataType<any>
  connectable: boolean
  default: unknown | ImplicitDefault
  props: WidgetProps
}

export interface LinkedInputSocket extends InputSocket {
  type: GlslTypeDef<any>
  connectable: true
}

export interface StreamInputSocket extends InputSocket {
  type: StreamType<any>
  connectable: true
}

export interface OutputSocket {
  name: string
  label: string
  type: LinkType
}

/** One node at one set of values: its sockets and its code. */
export interface NodeShape {
  title: string
  signature: string
  isOutput: boolean
  includes: GlslChunk[]
  inputs: InputSocket[]
  outputs: OutputSocket[]
  exec?(input: Record<string, any>, ctx: NodeContext): Record<string, Value>
  run?(input: Record<string, any>, state: any, frame: FrameInfo): Record<string, FrameValue>
  resolve?(input: Record<string, any>, env: ResolveEnv): Record<string, unknown>
  state?(): unknown
  standalone: Partial<Record<string, string>>
}

/**
 * A node kind. Its shape is a function of the node's stored values, so a parameter can change what sockets it has
 * and what it computes: a Math node set to Sine has one Value input, set to Wrap it has Value, Min and Max.
 */
export interface NodeItem {
  id: string
  title: string
  description: string
  category: CategoryId
  shape(values: Record<string, unknown>): NodeShape
  /** The shape with nothing set: what the menu lists and previews. */
  base: NodeShape
}
