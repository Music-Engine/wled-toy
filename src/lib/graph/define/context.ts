import type { GlslType } from '@/lib/shader/catalog'
import type { OutputSettings } from '@/lib/engine/output/output'
import type { Value } from './value'
import { sameJson } from '@/lib/util/json'

/** GLSL functions a node needs, emitted once per graph after the chunks it requires, so nodes share helpers */
export interface GlslChunk {
  id: string
  requires: GlslChunk[]
  source: string
  /** Already in pixel prelude and C++ header; only a frame pass pastes it */
  inPrelude?: true
}

export interface NodeContext<S = Record<string, Value>> {
  nodeId: string
  /** Lvalues holding last frame's value until assigned: read as any value, write via `emit` */
  state: S
  /** `data` from `resolve` */
  resolved: Record<string, unknown>
  /** Type generic sockets resolved to */
  gen: GlslType
  /** Unique to the node, stable across compiles so unchanged graphs emit unchanged code */
  variable(suffix?: string): string
  emit(line: string): void
  /** Emits `type name = expr;`, returns the variable */
  declare(type: GlslType, expr: string, suffix?: string): Value
  /** For chunks depending on resolved types, unlike `includes` */
  include(chunk: GlslChunk): void
  /** GLSL function returning via `out` params, declared here and passed last */
  call<O extends Record<string, GlslType>>(name: string, args: string[], outs: O): { [K in keyof O]: Value }
  issue(message: string): void
}

/** What the engine provides: audio source, analysis, image layer, OSC port, ... */
interface Requirement {
  kind: string
  config: unknown
}

/** Compiler registers `requires` and reports `issues` on the node */
export interface ResolveResult {
  /** Per stream output */
  streams?: Record<string, unknown>
  /** Body's `ctx.resolved`, never merged into inputs */
  data?: Record<string, unknown>
  requires?: Requirement[]
  issues?: string[]
  /** Output node's wire settings */
  output?: OutputSettings
  /** By output name: host-written value the output reads instead of a body's */
  uniforms?: Record<string, Uniform>
}

/** Float the host writes before each frame; `default` holds until then */
export type Uniform = { default: number } & (
  | { kind: 'knob'; label: string; min: number; max: number; cc: number }
  // Gate: 1 while controller or key above 0
  | { kind: 'midi'; message: 'cc' | 'note'; channel: number; number: number; gate: boolean }
  | { kind: 'osc'; address: string; argument: number }
)

/** Registered by earlier nodes, by kind, in topo order */
export type Resources = Readonly<Record<string, readonly unknown[] | undefined>>

/** Index of `config` among `kind`'s configs, or the one registering it gives; equal configs share one, as the compiler registers */
export function findResourceIndex(resources: Resources, kind: string, config: unknown): number {
  const list = resources[kind] ?? []
  const index = list.findIndex((other) => sameJson(other, config))
  return index >= 0 ? index : list.length
}
