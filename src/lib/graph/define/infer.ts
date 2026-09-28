import type { DataType } from './types'
import type { Value } from './value'

type SocketType<D> = Required<D extends { type: infer T extends DataType<any, any> } ? T : Extract<D, DataType<any, any>>>
export type Inputs<I> = { [K in keyof I]: SocketType<I[K]>[I[K] extends { linkable: false } ? '_stored' : '_linked'] }
export type Outputs<O> = { [K in keyof O]: SocketType<O[K]>['_linked'] }

/** Named slots, each holding a value between frames */
export type StateDef = Record<string, DataType<any, any>>
export type BodyState<S extends StateDef> = { readonly [K in keyof S]: Value }
