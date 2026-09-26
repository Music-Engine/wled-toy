import { computed, provide, type Ref } from 'vue'
import { graphIssuesKey } from '@/features/node-ui/graph-context'
import type { GraphEditSession } from '@/lib/documents/graph-session'
import type { GraphIssue } from '@/lib/graph'
import { parseGlslErrors } from '@/lib/shader/glsl-diagnostics'

/**
 * Every problem the graph has, first to last: the document's own (a failed open or save), the compiler's error and issues,
 * and the GLSL errors traced back to the node that emitted the line. Nodes read theirs through `graphIssuesKey`.
 */
export function useProblems(session: GraphEditSession, documentError: Ref<string | null | undefined>) {
  const compileIssues = computed<GraphIssue[]>(() => {
    const error = session.compileError.value
    if (!error) return []
    const found = parseGlslErrors(error).map(({ line, message }) => ({ nodeId: session.compiledLineNodes.value[line] ?? null, message: `GLSL: ${message}` }))
    return found.length ? found : [{ nodeId: null, message: `GLSL: ${error.trim().split('\n')[0]}` }]
  })

  const problems = computed<GraphIssue[]>(() => {
    const generated = session.generated.value
    return [
      ...(documentError.value ? [{ nodeId: null, message: documentError.value }] : []),
      ...(generated.error ? [{ nodeId: generated.errorNode, message: generated.error }] : []),
      ...generated.issues,
      ...compileIssues.value,
    ]
  })

  const nodeIssues = computed(() => {
    const map = new Map<string, string[]>()
    for (const { nodeId, message } of problems.value) {
      if (nodeId) map.set(nodeId, [...(map.get(nodeId) ?? []), message])
    }
    return map
  })
  provide(graphIssuesKey, nodeIssues)

  return problems
}
