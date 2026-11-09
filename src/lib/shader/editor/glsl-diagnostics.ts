import type { Text } from '@codemirror/state'
import type { Diagnostic } from '@codemirror/lint'

/** `ERROR: <source>:<line>: <message>` entries, 1-based lines; `source` = `#line` source string, 0 unless set */
export const parseGlslErrors = (infoLog: string): { source: number; line: number; message: string }[] =>
  [...infoLog.matchAll(/ERROR:\s*(\d+):(\d+):\s*(.*)/g)].map((m) => ({ source: Number(m[1]), line: Number(m[2]), message: m[3].trim() }))

export function toDiagnostics(doc: Text, infoLog: string): Diagnostic[] {
  const out: Diagnostic[] = parseGlslErrors(infoLog).map((error) => {
    const line = doc.line(Math.min(Math.max(1, error.line), doc.lines))
    return { from: line.from, to: line.to, severity: 'error', message: error.message }
  })
  if (out.length === 0 && infoLog.trim()) out.push({ from: 0, to: 0, severity: 'error', message: infoLog.trim() })
  return out
}
