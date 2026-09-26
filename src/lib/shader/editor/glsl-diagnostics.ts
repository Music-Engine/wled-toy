import type { Text } from '@codemirror/state'
import type { Diagnostic } from '@codemirror/lint'

/** The `ERROR: 0:<line>: <message>` entries of a WebGL info log, with 1-based lines. */
export const parseGlslErrors = (infoLog: string): { line: number; message: string }[] =>
  [...infoLog.matchAll(/ERROR:\s*\d+:(\d+):\s*(.*)/g)].map((m) => ({ line: Number(m[1]), message: m[2].trim() }))

export function toDiagnostics(doc: Text, infoLog: string): Diagnostic[] {
  const out: Diagnostic[] = parseGlslErrors(infoLog).map((error) => {
    const line = doc.line(Math.min(Math.max(1, error.line), doc.lines))
    return { from: line.from, to: line.to, severity: 'error', message: error.message }
  })
  if (out.length === 0 && infoLog.trim()) out.push({ from: 0, to: 0, severity: 'error', message: infoLog.trim() })
  return out
}
