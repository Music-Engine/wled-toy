import type { ComputedRef, InjectionKey } from 'vue'

// the node UI's one inject: vue-flow renders the nodes itself, so the canvas cannot hand them props

/** Problems per node id (codegen issues and compile errors), provided by the graph editor. */
export const graphIssuesKey: InjectionKey<ComputedRef<Map<string, string[]>>> = Symbol('graphIssues')

/**
 * Which input sockets hold a link, per node id, computed once per edge change by the graph canvas. A node that reads the
 * whole edge array instead re-renders on every edge change, which is the whole canvas on every link.
 * The set of a node whose links did not change keeps its identity, so only the nodes a link touches re-render.
 */
export const connectedHandlesKey: InjectionKey<ComputedRef<Map<string, ReadonlySet<string>>>> = Symbol('connectedHandles')
