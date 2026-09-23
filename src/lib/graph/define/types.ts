import { socketColor, type GlslType } from '@/lib/shader/glsl'
import type { FrameInfo } from './node'
import { castTo, componentCount, floatLiteral, vectorLiteral, type Value } from './value'

export interface ImplicitDefault {
  expr: string
  label: string
  /** The same value once per frame, for a node that runs on the CPU; without it the socket needs a link there. */
  frame?: (frame: FrameInfo) => number
}

export const timeDefault: ImplicitDefault = { expr: 'iTime', label: 'time', frame: (frame) => frame.time }

/** A type a node stores in its values. `T` is the stored (JSON) shape. */
export interface DataType<T = unknown> {
  id: string
  label: string
  check(raw: unknown): raw is T
  initial(): T
  /** Passed to every widget that edits this type. */
  props?: Record<string, unknown>
}

/** A data type that also exists in GLSL, so sockets of it can be linked. */
export interface GlslTypeDef<T = unknown> extends DataType<T> {
  glsl: GlslType
  color: string
  castableFrom: readonly string[]
  cast(value: Value): Value
  literal(raw: T): Value
  /** What an unlinked socket evaluates to when the type has no editable literal. */
  implicit?: ImplicitDefault
}

/**
 * A type that is linked but never becomes a number: an audio stream, a spectrum. What flows along such a link is decided
 * while the graph compiles (see `resolve` in defineNode), so it costs nothing per frame. `T` is what the receiving node gets.
 */
export interface StreamType<T = unknown> extends DataType<T | null> {
  struct: true
  color: string
  castableFrom: readonly string[]
  /** Shown on an unlinked socket: what it uses when nothing is linked. */
  unlinked: string
}

/** Anything a link can carry. */
export type LinkType = GlslTypeDef<any> | StreamType<any>

export const isGlslType = (type: DataType<any>): type is GlslTypeDef<any> => 'glsl' in type
export const isStreamType = (type: DataType<any>): type is StreamType<any> => 'struct' in type

function struct<T>(id: string, label: string, color: string, unlinked: string): StreamType<T> {
  return { id, label, color, unlinked, struct: true, castableFrom: [], check: (raw): raw is T | null => raw === null || typeof raw === 'object', initial: () => null }
}

/** Marks a link as carrying audio. There is one live input, so the link says where a node listens, not what it hears. */
export const AudioStream = struct<{ source: true }>('audio', 'Audio', '#e0853d', 'live source')
/** An analyzed stream: `slot` picks the analysis (its band, history and chroma textures, and its features on the CPU). */
export const SpectrumStream = struct<{ slot: number }>('spectrum', 'Spectrum', '#d9568b', 'default FFT')

export function canCast(from: LinkType, to: LinkType): boolean {
  return from.id === to.id || to.castableFrom.includes(from.id)
}

const isFiniteNumber = (raw: unknown): raw is number => typeof raw === 'number' && Number.isFinite(raw)
const isVector = (length?: number) => (raw: unknown): raw is number[] =>
  Array.isArray(raw) && raw.every(isFiniteNumber) && (length === undefined ? raw.length >= 2 && raw.length <= 4 : raw.length === length)

function numeric<T>(id: string, label: string, glsl: GlslType, check: (raw: unknown) => raw is T, initial: () => T, literal: (raw: T) => Value): GlslTypeDef<T> {
  return {
    id, label, glsl, check, initial, literal,
    color: socketColor(glsl),
    // every numeric type converts to every other; see castTo for how
    castableFrom: ['float', 'int', 'vec2', 'vec3', 'color', 'vec4', 'genType'].filter((other) => other !== id),
    cast: (value) => castTo(value, glsl),
  }
}

function opaque(glsl: GlslType, label: string, implicit: ImplicitDefault): GlslTypeDef<never> {
  return {
    id: glsl, label, glsl, implicit,
    color: socketColor(glsl),
    castableFrom: [],
    check: (raw): raw is never => false,
    initial: () => { throw new Error(`${label} has no literal value`) },
    cast: (value) => {
      if (value.type !== glsl) throw new Error(`Cannot cast ${value.type} to ${glsl}`)
      return value
    },
    literal: () => ({ expr: implicit.expr, type: glsl }),
  }
}

export const Float = numeric('float', 'Float', 'float', isFiniteNumber, () => 0.5, floatLiteral)
export const Int = numeric('int', 'Integer', 'int', (raw): raw is number => Number.isInteger(raw), () => 0, (raw) => ({ expr: String(raw), type: 'int' }))
export const Vec2 = numeric('vec2', 'Vector 2', 'vec2', isVector(2), () => [0.5, 0.5], vectorLiteral)
export const Vec3 = numeric('vec3', 'Vector', 'vec3', isVector(3), () => [0.5, 0.5, 0.5], vectorLiteral)
export const Vec4 = numeric('vec4', 'Vector 4', 'vec4', isVector(4), () => [0.5, 0.5, 0.5, 1], vectorLiteral)
export const Color: GlslTypeDef<number[]> = { ...numeric('color', 'Color', 'vec3', isVector(3), () => [1, 0.45, 0.1], vectorLiteral), color: '#c7c729' }

/** Position of an option, for GLSL functions that take their mode as an int. */
export const enumIndex = (options: readonly EnumOption[], value: string) => String(options.findIndex((o) => o.value === value))

const isGeneric = (raw: unknown): raw is number | number[] => isFiniteNumber(raw) || isVector()(raw)

/**
 * Resolves per node to the widest type linked into its generic sockets. The compiler does
 * that resolution, so `cast` here only rejects values that are not numeric at all.
 */
export const GenType: GlslTypeDef<number | number[]> = {
  ...numeric('genType', 'Number or vector', 'genType', isGeneric, () => 0.5, (raw) => (Array.isArray(raw) ? vectorLiteral(raw) : floatLiteral(raw))),
  cast: (value) => {
    if (componentCount(value.type) === undefined) throw new Error(`Cannot cast ${value.type} to a number or vector`)
    return value
  },
}

export const Sampler2D = opaque('sampler2D', 'Texture', { expr: 'iImage', label: 'image' })

export const Bool: DataType<boolean> = {
  id: 'bool',
  label: 'Boolean',
  check: (raw): raw is boolean => typeof raw === 'boolean',
  initial: () => false,
}

export const Text: DataType<string> = {
  id: 'text',
  label: 'Text',
  check: (raw): raw is string => typeof raw === 'string' && raw.length <= 200,
  initial: () => '',
}

/** A stored string a node's own body edits (a file picker, a learn button); no widget is drawn for it. */
export const Reference: DataType<string> = {
  id: 'reference',
  label: 'Reference',
  check: (raw): raw is string => typeof raw === 'string' && raw.length <= 500,
  initial: () => '',
}

export interface EnumOption<V extends string = string> {
  value: V
  label: string
  /** Column heading in a grouped popup, e.g. Blender's Functions / Comparison / Rounding for Math. */
  group?: string
}

export function Enum<const V extends string>(options: readonly EnumOption<V>[]): DataType<V> {
  return {
    id: 'enum',
    label: 'Option',
    check: (raw): raw is V => options.some((o) => o.value === raw),
    initial: () => options[0].value,
    props: { options },
  }
}

export function typeForGlsl(glsl: GlslType): GlslTypeDef<any> {
  const type = [Float, Int, Vec2, Vec3, Vec4, Sampler2D, GenType].find((t) => t.glsl === glsl)
  if (!type) throw new Error(`No graph type for GLSL type ${glsl}`)
  return type
}
