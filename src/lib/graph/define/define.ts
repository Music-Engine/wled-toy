import { titleCase, type CategoryId } from '@/lib/shader/catalog'
import type { FrameContext, GlslChunk, NodeContext, ResolveResult, Resources } from './context'
import type { Inputs, Outputs, PixelState, State, StateDef } from './infer'
import type { NodeItem, NodePreset, NodeShape, OutputSocket, Socket, WidgetProps } from './shape'
import { isImplicit, type DataType } from './types'

/**
 * Defines a graph node: its sockets, how they are edited, and the GLSL it emits. Input order is the order rows appear
 * on the node. Given a function, the definition is rebuilt from the node's stored values whenever they change, so a
 * parameter can turn the node into a different shape.
 */
export function defineNode<const I extends Record<string, InputDef>, const O extends Record<string, OutputDef>, S extends StateDef = {}>(
  id: string,
  definition: NodeDefinition<I, O, S> | ((values: Record<string, any>) => NodeDefinition<I, O, S>),
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

export interface NodeDefinition<I extends Record<string, InputDef>, O extends Record<string, OutputDef>, S extends StateDef = {}> {
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
  /**
   * Emits the node's code once, in the C-family subset GLSL and the C++ header share. The compiler runs it in the frame
   * pass or the pixel pass, whichever its inputs need; `state` slots live in global or pixel state to match.
   */
  body?(input: Inputs<I, 'pixel'>, ctx: NodeContext<PixelState<S>>): Outputs<O, 'pixel'>
  /** `pixel` when the value differs per pixel whatever is linked in (a position, a texture sample), so the node never runs per frame. */
  varies?: 'pixel'
  /** The output the host reads back once per frame. */
  probe?: keyof O & string
  /**
   * Once per frame, in JS, for the old pipeline only. A node with only `frame` can hold state there. Beside `body`, the
   * old pipeline runs the body per pixel and this per frame, whichever its inputs need.
   */
  frame?(input: Inputs<I, 'frame'>, info: FrameContext<State<S>>): Outputs<O, 'frame'>
  /**
   * Beside `body` and `frame`, for a node that had only a frame body: the old pipeline keeps running `frame` alone, so
   * what it compiles does not change. Goes with the old pipeline at cut-over-8.
   */
  frameOnlyInOldPipeline?: true
  /**
   * While the graph compiles, from its stored values and the streams linked into it: what this node puts on its stream
   * outputs (Audio, Spectrum), what its bodies get as `resolved`, what the engine has to provide, the uniforms its
   * outputs read, and what is wrong.
   * `resources` is what earlier nodes registered, for a node whose result depends on the index its config gets.
   */
  resolve?(input: Inputs<I, 'pixel'>, resources: Resources): ResolveResult
  /**
   * Slots that start at their type's zero, in pixel state or global state after the node's pass. Global state survives
   * recompiles for as long as the node exists; pixel state starts over on every recompile, resize and clock reset.
   */
  state?: S
  presets?: NodePreset[]
}

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

function toShape<I extends Record<string, InputDef>, O extends Record<string, OutputDef>, S extends StateDef>(
  id: string,
  definition: NodeDefinition<I, O, S>,
): NodeShape {
  const { title, signature, isOutput, includes, input, output, body, varies, probe, frame, frameOnlyInOldPipeline, state, resolve } = definition
  if ('pixel' in definition) throw new Error(`${id}: pixel is now body`)
  if (!body && !frame && !resolve) throw new Error(`${id}: a node needs body, frame or resolve`)
  if (frameOnlyInOldPipeline && !(body && frame)) throw new Error(`${id}: frameOnlyInOldPipeline needs both body and frame`)
  // the old pipeline runs a body as its pixel body, so its state is pixel state there
  const oldPixel = frameOnlyInOldPipeline ? undefined : body
  if (state && body) checkSlots(id, state)
  return {
    title,
    signature: signature ?? '',
    isOutput: isOutput ?? false,
    includes: includes ?? [],
    inputs: Object.entries(input).map(([name, def]) => buildInputSocket(id, name, def)),
    outputs: Object.entries(output).map(([name, def]) => buildOutputSocket(id, name, def)),
    body: body as NodeShape['body'],
    varies,
    probe,
    pixel: oldPixel as NodeShape['pixel'],
    frame: frame as NodeShape['frame'],
    resolve: resolve as NodeShape['resolve'],
    state,
    stateScope: state && (oldPixel ? 'pixel' : 'frame'),
  }
}

function checkSlots(id: string, state: StateDef): void {
  for (const [name, type] of Object.entries(state)) {
    if (!keepsInShader(type)) throw new Error(`${id}.${name}: shader state holds a number or a vector of 1 to 4 components, not ${type.label}`)
  }
}

// pixel state and global state hold floats only, four to a layer or texel
const keepsInShader = (type: DataType<any>) => type.kind === 'value' && type.dim !== undefined && type.dim >= 1 && type.dim <= 4

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
