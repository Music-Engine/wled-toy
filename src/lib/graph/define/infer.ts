// The types a node's bodies see, inferred from its socket and state declarations.
import type { Rate } from './shape'
import type { DataType } from './types'
import type { Value } from './value'

type SocketType<D> = Required<D extends { type: infer T extends DataType<any, any, any> } ? T : Extract<D, DataType<any, any, any>>>
export type Inputs<I, V extends Rate> = { [K in keyof I]: SocketType<I[K]>[I[K] extends { linkable: false } ? '_frame' : `_${V}`] }
/**
 * A per-frame array literal is inferred as a readonly tuple under `const O`; the engine only reads outputs, so `frame` may
 * return either. A union rather than `Readonly` alone, which turns `any` into an object type.
 */
export type Outputs<O, V extends Rate> = { [K in keyof O]: { frame: SocketType<O[K]>['_frame'] | Readonly<SocketType<O[K]>['_frame']>; pixel: SocketType<O[K]>['_pixel'] }[V] }

/** A node's state: named slots, each holding a value of its type between frames. */
export type StateDef = Record<string, DataType<any, any, any>>
/** What a frame body finds in `info.state` for a slot declaration. */
export type State<S extends StateDef> = { -readonly [K in keyof S]: Required<S[K]>['_frame'] }
/** What a pixel body finds in `ctx.state` for a slot declaration. */
export type PixelState<S extends StateDef> = { readonly [K in keyof S]: Value }
