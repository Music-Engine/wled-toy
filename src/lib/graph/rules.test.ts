import { readdirSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it } from 'vitest'

const ROOTS = ['src/lib/graph/define', 'src/lib/graph/compile']

// keyed by file, enclosing function and the nested conditional's own text, so a site survives line shifts and any edit to it shows up here
const ALLOWED = [
  "src/lib/graph/compile/control-plan.ts planControl: out.type.glsl === 'genType' ? gen : componentCount(out.type.glsl) ?? 1",
  'src/lib/graph/compile/emit.ts evaluate: isLinkable(socket) ? linkedValue(c, id, node.data, socket) : c.storedValue(id, node.data, socket)',
  'src/lib/graph/compile/streams.ts resolveNode: isLinkable(socket) ? [] : [[socket.name, c.storedValue(id, node.data, socket)]]',
  "src/lib/graph/define/sockets.ts placement: shape.exec && !shape.run ? 'pixel' : 'either'",
  "src/lib/graph/define/value.ts castTo: f === 2 ? ', 0.0, 1.0' : ', 1.0'",
]

function sourceFiles(): string[] {
  return ROOTS.flatMap((root) =>
    readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.includes('__snapshots__'))
      .map((path) => `${root}/${path}`),
  )
}

function enclosingName(node: ts.Node): string {
  for (let at = node.parent; at; at = at.parent) {
    if (ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at)) return at.name?.getText() ?? '<anonymous>'
    if ((ts.isArrowFunction(at) || ts.isFunctionExpression(at)) && ts.isVariableDeclaration(at.parent)) return at.parent.name.getText()
  }
  return '<module>'
}

function nestedConditionals(path: string): string[] {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const found: string[] = []
  const visit = (node: ts.Node, insideConditional: boolean) => {
    const conditional = ts.isConditionalExpression(node)
    if (conditional && insideConditional) found.push(`${path} ${enclosingName(node)}: ${node.getText().replace(/\s+/g, ' ')}`)
    ts.forEachChild(node, (child) => visit(child, insideConditional || conditional))
  }
  visit(source, false)
  return found
}

it('no conditional expression nests inside another, beyond the sites that predate the rule', () => {
  const found = sourceFiles().flatMap(nestedConditionals).sort()
  expect(found).toEqual(ALLOWED)
  expect(ALLOWED).toHaveLength(5)
})
