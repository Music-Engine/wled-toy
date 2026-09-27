import { GRAPH_VERSION, normalizeDoc, type NodeGraph } from './doc'
import { lintDoc } from './lint'

/** The graph in a `.wledgraph` file, plus what lintDoc found in it before the parser tidied it. */
export function readGraphFile(text: string): { doc: NodeGraph; problems: string[] } {
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

  const graph = envelope.graph as Partial<NodeGraph> | undefined
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new GraphFileError('This is not a valid .wledgraph file: the graph is missing nodes or edges.')
  }
  if (graph.version !== GRAPH_VERSION) {
    throw new GraphFileError(`This graph was saved by an older version (${graph.version ?? 'unknown'}); this app reads version ${GRAPH_VERSION}.`)
  }

  return { doc: normalizeDoc(graph as NodeGraph), problems: lintDoc(graph as NodeGraph) }
}

export function serializeGraphFile(doc: NodeGraph): string {
  const envelope: GraphFileEnvelope = { app: APP_ID, formatVersion: FORMAT_VERSION, graph: doc }
  return JSON.stringify(envelope, null, 2)
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
