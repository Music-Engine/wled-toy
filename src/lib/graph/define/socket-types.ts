import { socketColor, type GlslType } from '@/lib/shader/glsl'
import type { DataType, EnumOption, GlslTypeDef, StreamType } from './types'
import { castTo, componentCount, floatLiteral, vectorLiteral, type Value } from './value'

export const Float = numeric('float', 'Float', 'float', isFiniteNumber, () => 0.5, floatLiteral)
export const Int = numeric('int', 'Integer', 'int', (raw): raw is number => Number.isInteger(raw), () => 0, (raw) => ({ expr: String(raw), type: 'int' }))
export const Vec2 = numeric('vec2', 'Vector 2', 'vec2', isVector(2), () => [0.5, 0.5], vectorLiteral)
export const Vec3 = numeric('vec3', 'Vector', 'vec3', isVector(3), () => [0.5, 0.5, 0.5], vectorLiteral)
export const Vec4 = numeric('vec4', 'Vector 4', 'vec4', isVector(4), () => [0.5, 0.5, 0.5, 1], vectorLiteral)
export const Color: GlslTypeDef<number[]> = { ...numeric('color', 'Color', 'vec3', isVector(3), () => [1, 0.45, 0.1], vectorLiteral), color: '#c7c729' }

/**
 * Resolves per node to the widest type linked into its generic sockets. The compiler does
 * that resolution, so `cast` here only rejects values that are not numeric at all.
 */
export const GenType: GlslTypeDef<number | number[]> = {
  ...numeric('genType', 'Number or vector', 'genType', (raw): raw is number | number[] => isFiniteNumber(raw) || isVector()(raw), () => 0.5, (raw) => (Array.isArray(raw) ? vectorLiteral(raw) : floatLiteral(raw))),
  cast: (value) => {
    if (componentCount(value.type) === undefined) throw new Error(`Cannot cast ${value.type} to a number or vector`)
    return value
  },
}

export const Sampler2D: GlslTypeDef<never> = {
  id: 'sampler2D', label: 'Texture', glsl: 'sampler2D', implicit: { expr: 'iImage', label: 'image' },
  color: socketColor('sampler2D'),
  castableFrom: [],
  check: (raw): raw is never => false,
  initial: () => { throw new Error('Texture has no literal value') },
  cast: (value) => {
    if (value.type !== 'sampler2D') throw new Error(`Cannot cast ${value.type} to sampler2D`)
    return value
  },
  literal: () => ({ expr: 'iImage', type: 'sampler2D' }),
}

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

export function Enum<const V extends string>(options: readonly EnumOption<V>[]): DataType<V> {
  return {
    id: 'enum',
    label: 'Option',
    check: (raw): raw is V => options.some((o) => o.value === raw),
    initial: () => options[0].value,
    props: { options },
  }
}

/** Position of an option, for GLSL functions that take their mode as an int. */
export const enumIndex = (options: readonly EnumOption[], value: string) => String(options.findIndex((o) => o.value === value))

/** Marks a link as carrying audio. There is one live input, so the link says where a node listens, not what it hears. */
export const AudioStream = stream<{ source: true }>('audio', 'Audio', '#e0853d', 'live source')
/** An analyzed stream: `slot` picks the analysis (its band, history and chroma textures, and its features on the CPU). */
export const SpectrumStream = stream<{ slot: number }>('spectrum', 'Spectrum', '#d9568b', 'default FFT')

function numeric<T>(id: string, label: string, glsl: GlslType, check: (raw: unknown) => raw is T, initial: () => T, literal: (raw: T) => Value): GlslTypeDef<T> {
  return {
    id, label, glsl, check, initial, literal,
    color: socketColor(glsl),
    // every numeric type converts to every other; see castTo for how
    castableFrom: ['float', 'int', 'vec2', 'vec3', 'color', 'vec4', 'genType'].filter((other) => other !== id),
    cast: (value) => castTo(value, glsl),
  }
}

function stream<T>(id: string, label: string, color: string, unlinked: string): StreamType<T> {
  return { id, label, color, unlinked, struct: true, castableFrom: [], check: (raw): raw is T | null => raw === null || typeof raw === 'object', initial: () => null }
}

function isFiniteNumber(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isFinite(raw)
}

function isVector(length?: number) {
  return (raw: unknown): raw is number[] =>
    Array.isArray(raw) && raw.every(isFiniteNumber) && (length === undefined ? raw.length >= 2 && raw.length <= 4 : raw.length === length)
}
