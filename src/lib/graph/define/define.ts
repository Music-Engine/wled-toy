import { titleCase, type CategoryId } from '@/lib/shader/glsl'
import type { FrameContext, GlslChunk, NodeContext, ResolveResult, Resources } from './context'
import type { NodeItem, NodePreset, NodeShape, OutputSocket, Socket, WidgetProps } from './shape'
import { isImplicit, type DataType } from './types'

/**
 * A type alone, or a type with options. Unlinked, a socket uses `default`: a literal the user can edit or an implicit
 * expression. `linkable: false` keeps the socket on the node, and both bodies receive the stored value.
 */
export type InputDef = DataType<any, any, any> | SocketDef

interface SocketDef {
  type: DataType<any, any, any>
  /** Shown next to the socket; an empty string hides the label. Defaults to the socket name in Title Case. */
  label?: string
  /** Extra props for the widget that edits this socket while it is unlinked; a function when they depend on the node's other values. */
  props?: WidgetProps
  linkable?: boolean
  default?: unknown
}

export type OutputDef = DataType<any, any, any> | { type: DataType<any, any, any>; label?: string }

type SocketType<D> = Required<D extends { type: infer T extends DataType<any, any, any> } ? T : Extract<D, DataType<any, any, any>>>
export type Inputs<I, V extends 'frame' | 'pixel'> = { [K in keyof I]: SocketType<I[K]>[I[K] extends { linkable: false } ? '_frame' : `_${V}`] }
/**
 * A per-frame array literal is inferred as a readonly tuple under `const O`; the engine only reads outputs, so `frame` may
 * return either. A union rather than `Readonly` alone, which turns `any` into an object type.
 */
export type Outputs<O, V extends 'frame' | 'pixel'> = { [K in keyof O]: { frame: SocketType<O[K]>['_frame'] | Readonly<SocketType<O[K]>['_frame']>; pixel: SocketType<O[K]>['_pixel'] }[V] }

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
  input: I
  output: O
  /** Per pixel: emits GLSL. A node with only `pixel` is drawn in the shader. */
  pixel?(input: Inputs<I, 'pixel'>, ctx: NodeContext): Outputs<O, 'pixel'>
  /**
   * Once per frame, in JS. A node with only `frame` can hold `state`, and its inputs must not vary per pixel. A node with
   * both is evaluated per frame whenever everything linked into it is, and in the shader otherwise.
   */
  frame?(input: Inputs<I, 'frame'>, info: FrameContext<S>): Outputs<O, 'frame'>
  /**
   * While the graph compiles, from its stored values and the streams linked into it: what this node puts on its stream
   * outputs (Audio, Spectrum), what its bodies get as `resolved`, what the engine has to provide, and what is wrong.
   * `resources` is what earlier nodes registered, for a node whose result depends on the index its config gets.
   */
  resolve?(input: Inputs<I, 'pixel'>, resources: Resources): ResolveResult
  /** Fresh state for a frame-only node. It survives recompiles for as long as the node exists. */
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
  { title, signature, isOutput, includes, input, output, pixel, frame, state, resolve }: NodeItemOptions<I, O, S>,
): NodeShape {
  if (!pixel && !frame && !resolve) throw new Error(`${id}: a node needs pixel, frame or resolve`)
  if (state && pixel) throw new Error(`${id}: only a frame-only node can hold state; the shader has nowhere to keep it`)
  return {
    title,
    signature: signature ?? '',
    isOutput: isOutput ?? false,
    includes: includes ?? [],
    inputs: Object.entries(input).map(([name, def]) => buildInputSocket(id, name, def)),
    outputs: Object.entries(output).map(([name, def]) => buildOutputSocket(id, name, def)),
    pixel: pixel as NodeShape['pixel'],
    frame: frame as NodeShape['frame'],
    resolve: resolve as NodeShape['resolve'],
    state,
  }
}

function buildInputSocket(item: string, name: string, def: InputDef): Socket {
  const options: SocketDef = 'type' in def ? def : { type: def }
  const { type } = options
  const linkable = options.linkable !== false
  if (linkable && type.kind === 'param') throw new Error(`${item}.${name}: ${type.label} cannot be linked, so the socket must set linkable: false`)
  if (!linkable && type.kind === 'stream') throw new Error(`${item}.${name}: a stream only arrives over a link, so the socket must be linkable`)
  const fallback = options.default ?? type.initial()
  if (isImplicit(fallback) && !linkable) throw new Error(`${item}.${name}: default does not fit ${type.label}`)
  if (!isImplicit(fallback) && !type.check(fallback)) throw new Error(`${item}.${name}: default does not fit ${type.label}`)
  return { name, label: options.label ?? titleCase(name), type, linkable, default: fallback, props: options.props ?? {} }
}

function buildOutputSocket(item: string, name: string, def: OutputDef): OutputSocket {
  const { type, label } = 'type' in def ? def : { type: def, label: undefined }
  if (!label && name === 'out') throw new Error(`${item}: output "out" needs a label that says what it carries`)
  if (type.kind === 'param') throw new Error(`${item}.${name}: ${type.label} cannot be linked, so it cannot be an output`)
  return { name, label: label ?? titleCase(name), type }
}
