import { titleCase, type CategoryId } from '@/lib/shader/glsl'
import type { FrameInfo, GlslChunk, NodeContext, ResolveEnv } from './context'
import { implicitDefault, isImplicit, type InputSocket, type NodeItem, type NodePreset, type NodeShape, type OutputSocket, type WidgetProps } from './shape'
import { isGlslType, isStreamType, type DataType, type GlslTypeDef, type ImplicitDefault, type LinkType, type StreamType } from './types'

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

type SocketType<D> = Required<D extends { type: infer T extends DataType<any, any, any> } ? T : Extract<D, DataType<any, any, any>>>
/** A stored-only socket has no GLSL form, so both bodies receive its stored value. */
export type Inputs<I, V extends 'js' | 'glsl'> = { [K in keyof I]: SocketType<I[K]>[I[K] extends { connectable: false } ? '_js' : `_${V}`] }
/**
 * A per-frame array literal is inferred as a readonly tuple under `const O`; the engine only reads outputs, so `run` may
 * return either. A union rather than `Readonly` alone, which turns `any` into an object type.
 */
export type Outputs<O, V extends 'js' | 'glsl'> = { [K in keyof O]: { js: SocketType<O[K]>['_js'] | Readonly<SocketType<O[K]>['_js']>; glsl: SocketType<O[K]>['_glsl'] }[V] }

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
  exec?(input: Inputs<I, 'glsl'>, ctx: NodeContext): Outputs<O, 'glsl'>
  /**
   * Once per frame, on the CPU. A node with only `run` is control-rate: it can hold `state`, and its inputs must not vary
   * per pixel. A node with both runs on the CPU whenever everything linked into it does, and in the shader otherwise.
   */
  run?(input: Inputs<I, 'js'>, state: S, frame: FrameInfo): Outputs<O, 'js'>
  /**
   * While the graph compiles: what this node puts on its stream outputs (Audio, Spectrum), from its stored values and
   * the streams linked into it. Anything else it returns is handed to `exec` and `run` alongside their inputs.
   */
  resolve?(input: Inputs<I, 'glsl'>, env: ResolveEnv): Record<string, unknown>
  /** Fresh state for a control-rate node. It survives recompiles for as long as the node exists. */
  state?(): S
  presets?: NodePreset[]
}

/**
 * Defines a graph node: its sockets, how they are edited, and the GLSL it emits. Input order is the order rows appear
 * on the node. Given a function, the definition is rebuilt from the node's stored values whenever they change, so a
 * parameter can turn the node into a different shape.
 */
export function defineNode<const I extends Record<string, InputDef>, const O extends Record<string, OutputDef>, S = undefined>(
  id: string,
  definition: NodeItemOptions<I, O, S> | ((values: Record<string, any>) => NodeItemOptions<I, O, S>),
): NodeItem {
  const options = typeof definition === 'function' ? definition : () => definition
  const base = toShape(id, options({}))
  const { description, category, presets } = options({})
  return {
    id, description, category, base, presets,
    title: base.title,
    shape: typeof definition === 'function' ? (values) => toShape(id, options(values)) : () => base,
  }
}

function toShape<I extends Record<string, InputDef>, O extends Record<string, OutputDef>, S>(
  id: string,
  { title, signature, isOutput, includes, input, output, exec, run, state, resolve, standalone }: NodeItemOptions<I, O, S>,
): NodeShape {
  if (!exec && !run && !resolve) throw new Error(`${id}: a node needs exec, run or resolve`)
  if (state && exec) throw new Error(`${id}: only a control-rate node can hold state; the shader has nowhere to keep it`)
  return {
    title,
    signature: signature ?? '',
    isOutput: isOutput ?? false,
    includes: includes ?? [],
    inputs: Object.entries(input).map(([name, def]) => buildInputSocket(id, name, def)),
    outputs: Object.entries(output).map(([name, def]) => buildOutputSocket(id, name, def)),
    exec: exec as NodeShape['exec'],
    run: run as NodeShape['run'],
    resolve: resolve as NodeShape['resolve'],
    state,
    standalone: (standalone ?? {}) as NodeShape['standalone'],
  }
}

function buildInputSocket(item: string, name: string, def: InputDef): InputSocket {
  const options: SocketOptions & { type: DataType<any>; connectable?: boolean; default?: unknown } = 'type' in def ? def : { type: def }
  const { type } = options
  const connectable = options.connectable !== false
  if (connectable && !isGlslType(type) && !isStreamType(type)) throw new Error(`${item}.${name}: ${type.label} has no GLSL form, so the socket must set connectable: false`)
  const fallback = options.default ?? implicitDefault(type) ?? type.initial()
  if (isImplicit(fallback) && !connectable) throw new Error(`${item}.${name}: default does not fit ${type.label}`)
  if (!isImplicit(fallback) && !type.check(fallback)) throw new Error(`${item}.${name}: default does not fit ${type.label}`)
  return { name, label: options.label ?? titleCase(name), type, connectable, default: fallback, props: options.props ?? {} }
}

function buildOutputSocket(item: string, name: string, def: OutputDef): OutputSocket {
  const { type, label } = 'type' in def ? def : { type: def, label: undefined }
  if (!label && name === 'out') throw new Error(`${item}: output "out" needs a label that says what it carries`)
  return { name, label: label ?? titleCase(name), type }
}
