import { computed, provide, type Ref } from 'vue'
import { graphIssuesKey } from '@/features/node-ui/graph-context'
import type { GraphEditSession } from '@/lib/documents/sessions/graph-session'
import type { GraphIssue } from '@/lib/graph'
import { parseGlslErrors } from '@/lib/shader/editor/glsl-diagnostics'

/**
 * Every problem the graph has, first to last: the document's own (a failed open or save), the compiler's issues, and the
 * GLSL errors traced back to the node that emitted the line. Nodes read theirs through `graphIssuesKey`.
 */
export function useProblems(session: GraphEditSession, documentError: Ref<string | null | undefined>) {
  const compileIssues = computed<GraphIssue[]>(() => {
    const error = session.compileError.value
    if (!error) return []
    const lines = session.compiledLineNodes.value
    const found = parseGlslErrors(error).map(({ source, line, message }) => ({ nodeId: (source === 1 ? lines.frame : lines.pixel)[line] ?? null, message: `GLSL: ${message}` }))
    return found.length ? found : [{ nodeId: null, message: `GLSL: ${error.trim().split('\n')[0]}` }]
  })

  const problems = computed<GraphIssue[]>(() => {
    return [
      ...(documentError.value ? [{ nodeId: null, message: documentError.value }] : []),
      ...session.generated.value.issues,
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
