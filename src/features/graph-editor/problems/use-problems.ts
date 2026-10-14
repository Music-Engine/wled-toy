import { computed, provide, type Ref } from 'vue'
import { graphIssuesKey } from '@/features/node-ui/graph-context'
import type { GraphEditSession } from '@/lib/documents/sessions/graph-session'
import { FRAME_SOURCE_STRING, type GraphIssue } from '@/lib/graph'
import { parseGlslErrors } from '@/lib/shader/editor/glsl-diagnostics'

/** Document's own problem, compiler issues, GLSL errors traced to the node that emitted the line; nodes read theirs via `graphIssuesKey` */
export function useProblems(session: GraphEditSession, documentError: Ref<string | null | undefined>) {
  const compileIssues = computed(() => traceGlslErrors(session.compileError.value, session.compiledLineNodes.value))

  const problems = computed<GraphIssue[]>(() => {
    return [...(documentError.value ? [{ nodeId: null, message: documentError.value }] : []), ...session.generated.value.issues, ...compileIssues.value]
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

function traceGlslErrors(error: string | null, lines: GraphEditSession['compiledLineNodes']['value']): GraphIssue[] {
  if (!error) return []
  const found = parseGlslErrors(error).map(({ source, line, message }) => ({
    nodeId: (source === FRAME_SOURCE_STRING ? lines.frame : lines.pixel)[line] ?? null,
    message: `GLSL: ${message}`,
  }))
  return found.length ? found : [{ nodeId: null, message: `GLSL: ${error.trim().split('\n')[0]}` }]
}
