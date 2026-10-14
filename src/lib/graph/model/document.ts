import { computed, type InjectionKey } from 'vue'
import { createDocumentSession, documentSessions, type DocumentSession } from '@/lib/documents/sessions/document-session'
import type { FileBackend } from '@/lib/documents/files/file-backends'
import { canonical, createDefaultGraph, type NodeGraph } from './doc'
import { log } from '@/lib/app/logs'
import { GRAPH_FILE_EXTENSION, readGraphFile, serializeGraphFile } from './file'
import { migrate } from '@/lib/documents/files/migrate'

export type { DocumentPrompt, PromptChoice } from '@/lib/documents/sessions/document-session'

/** Call inside a component or an effect scope: the unload guard and the autosave end with it. */
export function createGraphDocument(options: { backend: FileBackend; getSnapshot: () => NodeGraph; onLoad: (doc: NodeGraph) => void }): GraphSession {
  const session = createDocumentSession<NodeGraph>({
    mode: 'graph',
    extension: GRAPH_FILE_EXTENSION,
    backend: options.backend,
    serialize: serializeGraphFile,
    parse: (text) => {
      const { doc, problems, migratedFrom } = readGraphFile(text, migrate)
      if (migratedFrom !== undefined) log(`Graph file: migrated from version ${migratedFrom} to ${doc.version}`)
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

export interface GraphSession extends DocumentSession<NodeGraph> {
  newGraph(): Promise<void>
}

/** The document the graph page edits right now. */
export const activeGraphDocument = computed(() => (documentSessions.graph ?? null) as GraphSession | null)

/** Provide a backend under this key (a native one under Tauri, a fake in tests) and the graph page uses it instead of the browser's. */
export const graphFileBackendKey: InjectionKey<FileBackend> = Symbol('graphFileBackend')
