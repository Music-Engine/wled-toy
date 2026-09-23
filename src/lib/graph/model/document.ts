import { computed, type InjectionKey } from 'vue'
import { createDocumentSession, documentSessions, type DocumentSession } from '@/lib/documents/document-session'
import type { FileBackend } from '@/lib/documents/documents'
import { GRAPH_NODE_TYPE, GRAPH_VERSION, createDefaultGraph, type NodeGraph, type GraphNodeData } from './doc'
import { log } from '@/lib/app/logs'
import { GRAPH_FILE_EXTENSION, readGraphFile, serializeGraphFile } from './file'

/** Provide a backend under this key (a native one under Tauri, a fake in tests) and the graph page uses it instead of the browser's. */
export const graphFileBackendKey: InjectionKey<FileBackend> = Symbol('graphFileBackend')

interface NodeLike {
  id: string
  type?: string
  position: { x: number; y: number }
  data?: GraphNodeData
}

interface EdgeLike {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  style?: unknown
}

/**
 * The one shape and key order a graph is stored in. The editor's snapshot and a freshly parsed file both go through it,
 * so a file that was just opened serializes to the text it was compared against and does not count as edited.
 */
export function storedDoc(nodes: readonly NodeLike[], edges: readonly EdgeLike[], scenes: NodeGraph['scenes']): NodeGraph {
  // plain JSON: structuredClone rejects the reactive proxies Vue leaves nested in node data
  return JSON.parse(JSON.stringify({
    nodes: nodes.map((n) => ({ id: n.id, type: n.type ?? GRAPH_NODE_TYPE, position: { x: n.position.x, y: n.position.y }, data: n.data })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
      style: e.style,
    })),
    scenes: scenes ?? [],
    version: GRAPH_VERSION,
  }))
}

const canonical = (doc: NodeGraph) => storedDoc(doc.nodes, doc.edges, doc.scenes)

export type { DocumentPrompt, PromptChoice } from '@/lib/documents/document-session'

export interface GraphSession extends DocumentSession<NodeGraph> {
  newGraph(): Promise<void>
}

/** The document the graph page edits right now. */
export const activeGraphDocument = computed(() => (documentSessions.graph ?? null) as GraphSession | null)

/** Call inside a component or an effect scope: the unload guard and the autosave end with it. */
export function createGraphDocument(options: { backend: FileBackend; getSnapshot: () => NodeGraph; onLoad: (doc: NodeGraph) => void }): GraphSession {
  const session = createDocumentSession<NodeGraph>({
    mode: 'graph',
    extension: GRAPH_FILE_EXTENSION,
    backend: options.backend,
    serialize: serializeGraphFile,
    parse: (text) => {
      const { doc, problems } = readGraphFile(text)
      for (const problem of problems) log(`Graph file: ${problem}`, 'warn')
      return canonical(doc)
    },
    createNew: () => canonical(createDefaultGraph()),
    getSnapshot: options.getSnapshot,
    onLoad: options.onLoad,
  })
  // the registry holds this very object, so the name the graph page calls has to land on it
  return Object.assign(session, { newGraph: session.newDocument })
}
