import type { DataType, EnumOption } from './types'
import type { Value } from './value'

// every numeric type converts to every other; the backends decide how
const NUMERIC = ['float', 'int', 'vec2', 'vec3', 'color', 'vec4', 'genType']

export const Float = numeric('float', 'Float', 1, isFiniteNumber, () => 0.5)
export const Int = numeric('int', 'Integer', 1, (raw): raw is number => Number.isInteger(raw), () => 0)
export const Vec2 = numeric('vec2', 'Vector 2', 2, isVector(2), () => [0.5, 0.5])
export const Vec3 = numeric('vec3', 'Vector', 3, isVector(3), () => [0.5, 0.5, 0.5])
export const Vec4 = numeric('vec4', 'Vector 4', 4, isVector(4), () => [0.5, 0.5, 0.5, 1])
export const Color = numeric('color', 'Color', 3, isVector(3), () => [1, 0.45, 0.1])

/** Resolves per node to the widest type linked into its generic sockets, so it has no width of its own. */
export const GenType: DataType<number | number[], number | number[], Value> = {
  id: 'genType',
  label: 'Number or vector',
  kind: 'value',
  check: (raw): raw is number | number[] => isFiniteNumber(raw) || isVector()(raw),
  initial: () => 0.5,
  castableFrom: NUMERIC.filter((other) => other !== 'genType'),
}

export const Sampler2D: DataType<never, never, Value> = {
  id: 'sampler2D',
  label: 'Texture',
  kind: 'value',
  castableFrom: [],
  check: (raw): raw is never => false,
  initial: () => { throw new Error('Texture has no literal value') },
}

export const Bool = param<boolean>('bool', 'Boolean', (raw): raw is boolean => typeof raw === 'boolean', () => false)
export const Text = param<string>('text', 'Text', (raw): raw is string => typeof raw === 'string' && raw.length <= 200, () => '')
/** A stored string a node's own body edits (a file picker, a learn button); no widget is drawn for it. */
export const Reference = param<string>('reference', 'Reference', (raw): raw is string => typeof raw === 'string' && raw.length <= 500, () => '')

export function Enum<const V extends string>(options: readonly EnumOption<V>[]): DataType<V> {
  return { ...param<V>('enum', 'Option', (raw): raw is V => options.some((o) => o.value === raw), () => options[0].value), props: { options } }
}

/** Position of an option, for shader functions that take their mode as an int. */
export const enumIndex = (options: readonly EnumOption[], value: string) => String(options.findIndex((o) => o.value === value))

/** Marks a link as carrying audio. There is one live input, so the link says where a node listens, not what it hears. */
export const AudioStream = stream<{ source: true }>('audio', 'Audio')
/** An analyzed stream: `slot` picks the analysis (its band, history and chroma textures, and its features on the CPU). */
export const SpectrumStream = stream<{ slot: number }>('spectrum', 'Spectrum')

function numeric<T>(id: string, label: string, dim: number, check: (raw: unknown) => raw is T, initial: () => T): DataType<T, T, Value> {
  return { id, label, kind: 'value', check, initial, castableFrom: NUMERIC.filter((other) => other !== id), dim }
}

function param<T>(id: string, label: string, check: (raw: unknown) => raw is T, initial: () => T): DataType<T> {
  return { id, label, kind: 'param', check, initial, castableFrom: [] }
}

/**
 * A type that is linked but never becomes a number: an audio stream, a spectrum. What flows along such a link is decided
 * while the graph compiles (see `resolve` in defineNode), so it costs nothing per frame. `T` is what the receiving node gets.
 */
function stream<T>(id: string, label: string): DataType<T | null> {
  return { id, label, kind: 'stream', castableFrom: [], check: (raw): raw is T | null => raw === null || typeof raw === 'object', initial: () => null }
}

function isFiniteNumber(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isFinite(raw)
}

function isVector(length?: number) {
  return (raw: unknown): raw is number[] =>
    Array.isArray(raw) && raw.every(isFiniteNumber) && (length === undefined ? raw.length >= 2 && raw.length <= 4 : raw.length === length)
}
