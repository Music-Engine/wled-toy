import type { ComputedRef, InjectionKey, Ref } from 'vue'

// the node UI's one inject: vue-flow renders the nodes itself, so the canvas cannot hand them props

/** Problems per node id (codegen issues and compile errors), provided by the graph editor. */
export const graphIssuesKey: InjectionKey<ComputedRef<Map<string, string[]>>> = Symbol('graphIssues')

/**
 * Which sockets hold a link, per node id, computed once per edge change by the graph canvas: inputs by name, outputs
 * under `outputHandle`, since an input and an output may share a name. A node that reads the
 * whole edge array instead re-renders on every edge change, which is the whole canvas on every link.
 * The set of a node whose links did not change keeps its identity, so only the nodes a link touches re-render.
 */
export const connectedHandlesKey: InjectionKey<ComputedRef<Map<string, ReadonlySet<string>>>> = Symbol('connectedHandles')

export const outputHandle = (name: string) => `out:${name}`

/** The node whose title is being edited, set by the graph editor's rename command. */
export const renamingNodeKey: InjectionKey<Ref<string | null>> = Symbol('renamingNode')
