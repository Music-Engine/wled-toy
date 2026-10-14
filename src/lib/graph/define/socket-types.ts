import type { DataType, EnumOption } from './types'
import type { Value } from './value'

// Every numeric type casts to every other; targets decide how
const NUMERIC = ['float', 'int', 'vec2', 'vec3', 'color', 'vec4', 'genType']

export const Float = createNumericType('float', 'Float', 1, isFiniteNumber, () => 0.5)
export const Int = createNumericType(
  'int',
  'Integer',
  1,
  (raw): raw is number => Number.isInteger(raw),
  () => 0,
)
export const Vec2 = createNumericType('vec2', 'Vector 2', 2, isVector(2), () => [0.5, 0.5])
export const Vec3 = createNumericType('vec3', 'Vector', 3, isVector(3), () => [0.5, 0.5, 0.5])
export const Vec4 = createNumericType('vec4', 'Vector 4', 4, isVector(4), () => [0.5, 0.5, 0.5, 1])
export const Color = createNumericType('color', 'Color', 3, isVector(3), () => [1, 0.45, 0.1])

/** Resolves per node to the widest type linked into its generic sockets */
export const GenType: DataType<number | number[], Value> = {
  id: 'genType',
  label: 'Number or vector',
  kind: 'value',
  check: (raw): raw is number | number[] => isFiniteNumber(raw) || isVector()(raw),
  initial: () => 0.5,
  castableFrom: listNumericCasts('genType'),
}

export const Sampler2D: DataType<never, Value> = {
  id: 'sampler2D',
  label: 'Texture',
  kind: 'value',
  castableFrom: [],
  check: (raw): raw is never => false,
  initial: () => {
    throw new Error('Texture has no literal value')
  },
}

export const Bool = createParamType<boolean>(
  'bool',
  'Boolean',
  (raw): raw is boolean => typeof raw === 'boolean',
  () => false,
)
export const Text = createParamType<string>(
  'text',
  'Text',
  (raw): raw is string => typeof raw === 'string' && raw.length <= 200,
  () => '',
)
/** Stored string the node's own UI edits (file picker, learn button); no widget */
export const Reference = createParamType<string>(
  'reference',
  'Reference',
  (raw): raw is string => typeof raw === 'string' && raw.length <= 500,
  () => '',
)

export function Enum<const V extends string>(options: readonly EnumOption<V>[]): DataType<V> {
  return {
    ...createParamType<V>(
      'enum',
      'Option',
      (raw): raw is V => options.some((option) => option.value === raw),
      () => options[0].value,
    ),
    props: { options },
  }
}

/** For shader functions taking their mode as an int */
export const toEnumIndex = (options: readonly EnumOption[], value: string) => String(options.findIndex((option) => option.value === value))

/** One live input, so the link says where a node listens, not what it hears */
export const AudioStream = createStreamType<{ source: true }>('audio', 'Audio')
/** `slot` picks the analysis: its band, history, chroma textures and features */
export const SpectrumStream = createStreamType<{ slot: number }>('spectrum', 'Spectrum')

function createNumericType<T>(id: string, label: string, dim: number, check: (raw: unknown) => raw is T, initial: () => T): DataType<T, Value> {
  return { id, label, kind: 'value', check, initial, castableFrom: listNumericCasts(id), dim }
}

function listNumericCasts(id: string): string[] {
  return NUMERIC.filter((other) => other !== id)
}

function createParamType<T>(id: string, label: string, check: (raw: unknown) => raw is T, initial: () => T): DataType<T> {
  return { id, label, kind: 'param', check, initial, castableFrom: [] }
}

/** Linked but never a number; settled at compile by `resolve`, so free per frame; `T` = what the receiver gets */
function createStreamType<T>(id: string, label: string): DataType<T | null> {
  return { id, label, kind: 'stream', castableFrom: [], check: (raw): raw is T | null => raw === null || typeof raw === 'object', initial: () => null }
}

function isFiniteNumber(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isFinite(raw)
}

function isVector(length?: number) {
  return (raw: unknown): raw is number[] =>
    Array.isArray(raw) && raw.every(isFiniteNumber) && (length === undefined ? raw.length >= 2 && raw.length <= 4 : raw.length === length)
}
