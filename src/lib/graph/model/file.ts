import { GRAPH_VERSION, normalizeDoc, type NodeGraph } from './doc'
import { lintDoc } from './lint'

/** Graph in a `.wledgraph` file, as readStoredGraph reads it */
export function readGraphFile(text: string, migrate = (graph: NodeGraph) => graph): StoredGraphReading {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new GraphFileError('This is not a valid .wledgraph file: the contents are not JSON.')
  }
  if (!parsed || typeof parsed !== 'object') throw new GraphFileError('This is not a valid .wledgraph file: expected a JSON object.')

  const envelope = parsed as Partial<GraphFileEnvelope>
  if (envelope.app !== APP_ID) throw new GraphFileError(`This is not a wledtoy graph file (found app "${envelope.app ?? 'unknown'}").`)
  if (envelope.formatVersion !== FORMAT_VERSION) {
    throw new GraphFileError(`This .wledgraph file is format version ${envelope.formatVersion ?? 'unknown'}; this app reads version ${FORMAT_VERSION}.`)
  }
  return readStoredGraph(envelope.graph, migrate)
}

/** Stored graph migrated, version-checked, linted before normalizeDoc tidies it; a file and the working copy both come here */
export function readStoredGraph(stored: unknown, migrate: (graph: NodeGraph) => NodeGraph): StoredGraphReading {
  const candidate = stored as Partial<NodeGraph> | undefined
  if (!candidate || !Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) {
    throw new GraphFileError('This is not a valid .wledgraph file: the graph is missing nodes or edges.')
  }
  const graph = migrate(candidate as NodeGraph)
  if (graph.version !== GRAPH_VERSION) {
    const age = graph.version > GRAPH_VERSION ? 'a newer' : 'an older'
    throw new GraphFileError(`This graph was saved by ${age} version (${graph.version ?? 'unknown'}); this app reads version ${GRAPH_VERSION}.`)
  }
  const migratedFrom = graph === candidate ? undefined : candidate.version
  return { doc: normalizeDoc(graph), problems: lintDoc(graph), migratedFrom }
}

export interface StoredGraphReading {
  doc: NodeGraph
  problems: string[]
  /** Version before `migrate` when it changed the graph */
  migratedFrom?: number
}

export function serializeGraphFile(doc: NodeGraph): string {
  const envelope: GraphFileEnvelope = { app: APP_ID, formatVersion: FORMAT_VERSION, graph: doc }
  return `${JSON.stringify(envelope, null, 2)}\n`
}

/** Extension a `.wledgraph` file is saved and opened with. */
export const GRAPH_FILE_EXTENSION = '.wledgraph'

/** A `.wledgraph` file that failed to parse; the message is specific enough to show the user as-is. */
export class GraphFileError extends Error {}

interface GraphFileEnvelope {
  app: string
  formatVersion: number
  graph: NodeGraph
}

const APP_ID = 'wledtoy'
const FORMAT_VERSION = 1
