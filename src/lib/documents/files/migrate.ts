import type { NodeGraph } from '@/lib/graph/model/doc'

/**
 * Version 3 to 4: only the version changes; nodes, kinds, values, edges and scenes keep their ids and content. Any
 * other version comes back as is, for readGraphFile to accept or refuse
 */
export function migrate(doc: NodeGraph): NodeGraph {
  return doc.version === 3 ? { ...doc, version: 4 } : doc
}
