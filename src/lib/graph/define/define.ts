import { titleCase, type CategoryId } from '@/lib/shader/catalog'
import type { GlslChunk, NodeContext, ResolveResult, Resources } from './context'
import type { BodyState, Inputs, Outputs, StateDef } from './infer'
import type { NodeItem, NodePreset, NodeShape, OutputSocket, Socket, WidgetProps } from './shape'
import { isImplicit, type DataType } from './types'

/** Input order = row order on the node; a function definition rebuilds from stored values, so a param can reshape the node */
export function defineNode<const I extends Record<string, InputDef>, const O extends Record<string, OutputDef>, S extends StateDef = {}>(
  id: string,
  definition: NodeDefinition<I, O, S> | ((values: Record<string, any>) => NodeDefinition<I, O, S>),
): NodeItem {
  const options = typeof definition === 'function' ? definition : () => definition
  const base = toShape(id, options({}))
  const { description, category, presets } = options({})
  return {
    id,
    description,
    category,
    base,
    presets,
    title: base.title,
    shape: typeof definition === 'function' ? (values) => toShape(id, options(values)) : () => base,
  }
}

export interface NodeDefinition<I extends Record<string, InputDef>, O extends Record<string, OutputDef>, S extends StateDef = {}> {
  title: string
  description: string
  category: CategoryId
  /** GLSL shown in the menu preview */
  signature?: string
  /** Sink the compile starts from */
  isOutput?: boolean
  /** GLSL the node's code calls into */
  includes?: GlslChunk[]
  input: I
  output: O
  /** Code in the C subset GLSL and the C++ header share; emitted into whichever pass the inputs need */
  body?(input: Inputs<I>, ctx: NodeContext<BodyState<S>>): Outputs<O>
  /** `pixel` when the value differs per pixel whatever is linked (position, texture sample) */
  varies?: 'pixel'
  /** `frame` for a body too costly per fragment (loops over bins); ignored when an input varies per pixel */
  prefers?: 'frame'
  /** Output the host reads back once per frame */
  probe?: keyof O & string
  /**
   * At compile, from stored values and linked streams: stream outputs, body data, host requirements, uniforms, issues;
   * `resources` = what earlier nodes registered, for a result depending on its config's index
   */
  resolve?(input: Inputs<I>, resources: Resources): ResolveResult
  /** Slots starting at zero; global state survives recompiles while the node exists, pixel state restarts on recompile, resize, reset */
  state?: S
  presets?: NodePreset[]
}

/** Unlinked socket uses `default`, an editable literal or implicit expression; `linkable: false` hands the body the stored value */
export type InputDef = DataType<any, any> | SocketOptions

interface SocketOptions {
  type: DataType<any, any>
  /** Empty hides it; default = name in Title Case */
  label?: string
  /** Widget props while unlinked; a function when they depend on other values */
  props?: WidgetProps
  linkable?: boolean
  default?: unknown
}

export type OutputDef = DataType<any, any> | { type: DataType<any, any>; label?: string }

function toShape<I extends Record<string, InputDef>, O extends Record<string, OutputDef>, S extends StateDef>(
  id: string,
  definition: NodeDefinition<I, O, S>,
): NodeShape {
  const { title, signature, isOutput, includes, input, output, body, varies, prefers, probe, state, resolve } = definition
  if (!body && !resolve) throw new Error(`${id}: a node needs body or resolve`)
  if (state) checkSlots(id, state)
  return {
    title,
    signature: signature ?? '',
    isOutput: isOutput ?? false,
    includes: includes ?? [],
    inputs: Object.entries(input).map(([name, declared]) => buildInputSocket(id, name, declared)),
    outputs: Object.entries(output).map(([name, declared]) => buildOutputSocket(id, name, declared)),
    body: body as NodeShape['body'],
    varies,
    prefers,
    probe,
    resolve: resolve as NodeShape['resolve'],
    state,
  }
}

function checkSlots(id: string, state: StateDef): void {
  for (const [name, type] of Object.entries(state)) {
    if (!keepsInShader(type)) throw new Error(`${id}.${name}: shader state holds a number or a vector of 1 to 4 components, not ${type.label}`)
  }
}

function buildInputSocket(item: string, name: string, declared: InputDef): Socket {
  const options: SocketOptions = 'type' in declared ? declared : { type: declared }
  const { type } = options
  const linkable = options.linkable !== false
  if (linkable && type.kind === 'param') throw new Error(`${item}.${name}: ${type.label} cannot be linked, so the socket must set linkable: false`)
  if (!linkable && type.kind === 'stream') throw new Error(`${item}.${name}: a stream only arrives over a link, so the socket must be linkable`)
  const fallback = options.default ?? type.initial()
  if (isImplicit(fallback) && !linkable) throw new Error(`${item}.${name}: default does not fit ${type.label}`)
  if (!isImplicit(fallback) && !type.check(fallback)) throw new Error(`${item}.${name}: default does not fit ${type.label}`)
  return { name, label: options.label ?? titleCase(name), type, linkable, default: fallback, props: options.props ?? {} }
}

function buildOutputSocket(item: string, name: string, declared: OutputDef): OutputSocket {
  const { type, label } = 'type' in declared ? declared : { type: declared, label: undefined }
  if (!label && name === 'out') throw new Error(`${item}: output "out" needs a label that says what it carries`)
  if (type.kind === 'param') throw new Error(`${item}.${name}: ${type.label} cannot be linked, so it cannot be an output`)
  return { name, label: label ?? titleCase(name), type }
}

// State holds floats only, four to a layer or texel
export const keepsInShader = (type: DataType<any>) => type.kind === 'value' && type.dim !== undefined && type.dim >= 1 && type.dim <= 4
