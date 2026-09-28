import { expect, it } from 'vitest'
import { Text } from '@codemirror/state'
import { parseGlslErrors, toDiagnostics } from './glsl-diagnostics'

const LOG = "ERROR: 0:3: 'foo' : undeclared identifier\nERROR: 0:7: syntax error \n"

it('reads each ERROR line of an info log with its line number', () => {
  expect(parseGlslErrors(LOG)).toEqual([
    { source: 0, line: 3, message: "'foo' : undeclared identifier" },
    { source: 0, line: 7, message: 'syntax error' },
  ])
  expect(parseGlslErrors('link failed')).toEqual([])
  expect(parseGlslErrors('ERROR: 1:12: syntax error')).toEqual([{ source: 1, line: 12, message: 'syntax error' }])
})

it('marks the reported line, and the whole log at the start when no line is given', () => {
  const doc = Text.of(['a', 'b', 'ccc'])
  expect(toDiagnostics(doc, "ERROR: 0:3: 'foo' : undeclared identifier")).toEqual([
    { from: 4, to: 7, severity: 'error', message: "'foo' : undeclared identifier" },
  ])
  expect(toDiagnostics(doc, ' link failed ')).toEqual([{ from: 0, to: 0, severity: 'error', message: 'link failed' }])
})
