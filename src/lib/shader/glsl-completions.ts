import { StateField, type EditorState, type Text } from '@codemirror/state'
import { hoverTooltip, showTooltip, type Tooltip } from '@codemirror/view'
import { snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { CATEGORIES, GLSL_EXTRA_BUILTINS, GLSL_KEYWORDS, GLSL_TYPES, NODES, categoryById, nodeByName, type ShaderNode } from './catalog'
import { highlightGlslHtml } from './glsl-highlight'

function nodeInfo(node: ShaderNode, activeParam = -1): HTMLElement {
  const category = categoryById.get(node.category)
  const dom = document.createElement('div')
  dom.className = 'cm-glsl-doc'

  const head = document.createElement('div')
  head.className = 'cm-glsl-doc-head'
  const swatch = document.createElement('span')
  swatch.className = 'cm-glsl-doc-swatch'
  swatch.style.background = category?.color ?? '#666'
  const title = document.createElement('span')
  title.textContent = `${node.title} · ${category?.label ?? ''}`
  head.append(swatch, title)

  const sig = document.createElement('code')
  if (node.kind === 'function' && activeParam >= 0) {
    const token = (text: string, className: string) => Object.assign(document.createElement('span'), { textContent: text, className })
    sig.append(token(node.returns, 'glsl-type'), ' ', token(node.name, 'glsl-api'), '(')
    node.params.forEach((p, i) => {
      const param = token('', i === activeParam ? 'cm-glsl-doc-active' : '')
      param.append(token(p.type, 'glsl-type'), ` ${p.name}`)
      sig.append(param)
      if (i < node.params.length - 1) sig.append(', ')
    })
    sig.append(')')
  } else {
    // highlightGlslHtml escapes the source before adding markup
    sig.innerHTML = highlightGlslHtml(node.signature)
  }

  const doc = document.createElement('p')
  doc.textContent = node.doc
  dom.append(head, sig, doc)
  return dom
}

const COMPLETION_TYPE: Record<ShaderNode['kind'], string> = { function: 'function', uniform: 'constant', recipe: 'namespace', graph: 'text' }
const sectionRank = new Map(CATEGORIES.map((c, i) => [c.id, i]))

const staticCompletions: Completion[] = [
  ...NODES.map((node) => {
    const base: Completion = {
      label: node.name,
      type: COMPLETION_TYPE[node.kind],
      detail: node.kind === 'recipe' ? node.title : node.returns,
      info: () => nodeInfo(node),
      section: { name: categoryById.get(node.category)!.label, rank: sectionRank.get(node.category) },
      boost: node.category === 'builtin' ? 0 : 5,
    }
    return node.kind === 'uniform' ? base : snippetCompletion(node.snippet, base)
  }),
  ...GLSL_KEYWORDS.map((label) => ({ label, type: 'keyword', section: { name: 'Keywords', rank: 90 }, boost: -2 })),
  ...GLSL_TYPES.map((label) => ({ label, type: 'type', section: { name: 'Types', rank: 91 }, boost: 1 })),
  ...GLSL_EXTRA_BUILTINS.map((label) => ({ label, type: 'function', detail: 'builtin', section: { name: 'GLSL Math', rank: sectionRank.get('builtin') } })),
]
const staticLabels = new Set(staticCompletions.map((c) => c.label))

const DECLARATION = /\b(?:float|int|uint|bool|vec[234]|ivec[234]|mat[234])\s+([A-Za-z_]\w*)/g

function inComment(state: EditorState, pos: number) {
  const line = state.doc.lineAt(pos)
  const before = line.text.slice(0, pos - line.from)
  return before.includes('//')
}

export function glslCompletions(ctx: CompletionContext): CompletionResult | null {
  const word = ctx.matchBefore(/\w*/)
  if (!word || (word.from === word.to && !ctx.explicit)) return null
  if (inComment(ctx.state, ctx.pos)) return null
  const locals = new Set<string>()
  for (const m of ctx.state.doc.toString().matchAll(DECLARATION)) {
    if (!staticLabels.has(m[1])) locals.add(m[1])
  }
  const localOptions: Completion[] = [...locals].map((label) => ({ label, type: 'variable', section: { name: 'Local', rank: -1 }, boost: 3 }))
  return { from: word.from, options: [...localOptions, ...staticCompletions], validFor: /^\w*$/ }
}

function wordAt(doc: Text, pos: number) {
  const line = doc.lineAt(pos)
  let start = pos - line.from
  let end = start
  while (start > 0 && /\w/.test(line.text[start - 1])) start--
  while (end < line.text.length && /\w/.test(line.text[end])) end++
  if (start === end) return null
  return { from: line.from + start, to: line.from + end, text: line.text.slice(start, end) }
}

export const glslHover = hoverTooltip((view, pos) => {
  const word = wordAt(view.state.doc, pos)
  const node = word && nodeByName.get(word.text)
  if (!word || !node) return null
  return { pos: word.from, end: word.to, above: true, create: () => ({ dom: nodeInfo(node) }) }
})

/** Finds the innermost unclosed call around the cursor, e.g. `mix(a, |` gives mix and argument 1. */
function callAt(state: EditorState, pos: number) {
  const start = Math.max(0, pos - 400)
  const text = state.doc.sliceString(start, pos)
  let depth = 0
  let arg = 0
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i]
    if (ch === ')') depth++
    else if (ch === '(') {
      if (depth === 0) {
        const name = /([A-Za-z_]\w*)\s*$/.exec(text.slice(0, i))
        return name ? { name: name[1], arg, pos: start + i - name[1].length } : null
      }
      depth--
    } else if (ch === ',' && depth === 0) arg++
    else if (ch === ';' || ch === '{' || ch === '}') return null
  }
  return null
}

function signatureTooltip(state: EditorState): Tooltip | null {
  const sel = state.selection.main
  if (!sel.empty) return null
  const call = callAt(state, sel.head)
  const node = call && nodeByName.get(call.name)
  if (!call || !node || node.kind !== 'function' || node.params.length === 0) return null
  return { pos: call.pos, above: true, strictSide: true, arrow: false, create: () => ({ dom: nodeInfo(node, call.arg) }) }
}

export const signatureHelp = StateField.define<Tooltip | null>({
  create: signatureTooltip,
  update: (value, tr) => (tr.docChanged || tr.selection ? signatureTooltip(tr.state) : value),
  provide: (f) => showTooltip.from(f),
})
