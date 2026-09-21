import { StreamLanguage, syntaxHighlighting, LanguageSupport, type StreamParser } from '@codemirror/language'
import { StateField, type EditorState, type Text } from '@codemirror/state'
import { EditorView, hoverTooltip, showTooltip, type Tooltip } from '@codemirror/view'
import { snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import type { Diagnostic } from '@codemirror/lint'
import { highlightCode, tagHighlighter, tags as t, Tag } from '@lezer/highlight'
import { CATEGORIES, GLSL_EXTRA_BUILTINS, GLSL_KEYWORDS, GLSL_TYPES, NODES, categoryById, nodeByName, type ShaderNode } from './glsl'

const apiTag = Tag.define()
const uniformTag = Tag.define()

const keywords = new Set(GLSL_KEYWORDS)
const types = new Set(GLSL_TYPES)
const builtins = new Set([...GLSL_EXTRA_BUILTINS, ...NODES.filter((n) => n.category === 'builtin').map((n) => n.name)])

const parser: StreamParser<{ inComment: boolean }> = {
  name: 'glsl',
  startState: () => ({ inComment: false }),
  token(stream, state) {
    if (state.inComment) {
      if (stream.skipTo('*/')) {
        stream.pos += 2
        state.inComment = false
      } else {
        stream.skipToEnd()
      }
      return 'comment'
    }
    if (stream.eatSpace()) return null
    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match('/*')) {
      state.inComment = true
      return 'comment'
    }
    if (stream.match(/^#\s*\w+/)) return 'meta'
    if (stream.match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?[uf]?/i)) return 'number'
    if (stream.match(/^[A-Za-z_]\w*/)) {
      const word = stream.current()
      if (keywords.has(word)) return 'keyword'
      if (types.has(word)) return 'typeName'
      if (builtins.has(word)) return 'builtin'
      const node = nodeByName.get(word)
      if (node) return node.kind === 'uniform' ? 'uniform' : 'api'
      return 'variableName'
    }
    if (stream.match(/^[+\-*/%=<>!&|^~?:]+/)) return 'operator'
    stream.next()
    return null
  },
  tokenTable: { builtin: t.standard(t.function(t.variableName)), api: apiTag, uniform: uniformTag },
  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
    closeBrackets: { brackets: ['(', '[', '{'] },
    indentOnInput: /^\s*\}$/,
  },
}

const glslLanguage = StreamLanguage.define(parser)

// token colors live in main.css so the editor and static code blocks share one palette
export const glslHighlighter = tagHighlighter([
  { tag: t.comment, class: 'glsl-comment' },
  { tag: t.keyword, class: 'glsl-keyword' },
  { tag: t.typeName, class: 'glsl-type' },
  { tag: t.number, class: 'glsl-number' },
  { tag: t.meta, class: 'glsl-meta' },
  { tag: t.operator, class: 'glsl-operator' },
  { tag: t.standard(t.function(t.variableName)), class: 'glsl-builtin' },
  { tag: apiTag, class: 'glsl-api' },
  { tag: uniformTag, class: 'glsl-uniform' },
])

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Escaped, span-wrapped HTML for a GLSL snippet using the editor's token classes. */
export function highlightGlslHtml(code: string): string {
  let html = ''
  highlightCode(
    code,
    glslLanguage.parser.parse(code),
    glslHighlighter,
    (text, classes) => {
      html += classes ? `<span class="${classes}">${escapeHtml(text)}</span>` : escapeHtml(text)
    },
    () => {
      html += '\n'
    },
  )
  return html
}

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

const glslHover = hoverTooltip((view, pos) => {
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

const signatureHelp = StateField.define<Tooltip | null>({
  create: signatureTooltip,
  update: (value, tr) => (tr.docChanged || tr.selection ? signatureTooltip(tr.state) : value),
  provide: (f) => showTooltip.from(f),
})

export function toDiagnostics(doc: Text, infoLog: string): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const m of infoLog.matchAll(/ERROR:\s*\d+:(\d+):\s*(.*)/g)) {
    const line = doc.line(Math.min(Math.max(1, Number(m[1])), doc.lines))
    out.push({ from: line.from, to: line.to, severity: 'error', message: m[2].trim() })
  }
  if (out.length === 0 && infoLog.trim()) out.push({ from: 0, to: 0, severity: 'error', message: infoLog.trim() })
  return out
}

const editorTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--ui-bg)', color: 'var(--ui-text)', fontSize: '14px' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-content': { caretColor: 'var(--ui-primary)', padding: '12px 0' },
  '.cm-gutters': { backgroundColor: 'var(--ui-bg)', color: 'var(--ui-text-dimmed)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--ui-bg-elevated) 60%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ui-text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in oklab, var(--ui-primary) 28%, transparent) !important',
  },
  '.cm-cursor': { borderLeftColor: 'var(--ui-primary)' },
  '.cm-matchingBracket': { backgroundColor: 'color-mix(in oklab, var(--ui-primary) 20%, transparent)', outline: 'none' },
  '.cm-tooltip': { backgroundColor: 'var(--ui-bg-elevated)', color: 'var(--ui-text)', border: '1px solid var(--ui-border)', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 8px 24px rgb(0 0 0 / 0.35)' },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', maxHeight: '18em' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '2px 8px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'color-mix(in oklab, var(--ui-primary) 30%, transparent)', color: 'var(--ui-text-highlighted)' },
  '.cm-completionSection': { color: 'var(--ui-text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '4px 8px', borderBottom: '1px solid var(--ui-border)', opacity: '1' },
  '.cm-completionDetail': { color: 'var(--ui-text-muted)', fontStyle: 'normal', marginLeft: '0.75em' },
  '.cm-completionInfo': { padding: '0' },
  '.cm-glsl-doc': { padding: '8px 10px', maxWidth: '400px', fontSize: '13px', fontFamily: 'var(--font-sans)' },
  '.cm-glsl-doc-head': { display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ui-text-muted)', fontSize: '12px', marginBottom: '4px' },
  '.cm-glsl-doc-swatch': { width: '8px', height: '8px', borderRadius: '2px' },
  '.cm-glsl-doc code': { display: 'block', fontFamily: 'var(--font-mono)', color: 'var(--ui-text-highlighted)', marginBottom: '4px' },
  '.cm-glsl-doc-active': { color: 'var(--ui-primary)', fontWeight: '700', textDecoration: 'underline' },
  '.cm-glsl-doc p': { margin: '0', color: 'var(--ui-text-toned)' },
  '.cm-diagnostic': { fontFamily: 'var(--font-mono)' },
  '.cm-panels': { backgroundColor: 'var(--app-chrome)', color: 'var(--ui-text)', fontFamily: 'var(--font-sans)' },
  '.cm-panels-top': { borderBottom: '1px solid var(--app-hairline)' },
  '.cm-panels-bottom': { borderTop: '1px solid var(--app-hairline)' },
  '.cm-panel.cm-search': { padding: '4px 32px 4px 8px' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': { margin: '2px 6px 2px 0' },
  '.cm-panel.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '4px', verticalAlign: 'middle', fontSize: '12px', color: 'var(--ui-text-muted)', whiteSpace: 'nowrap' },
  '.cm-panel.cm-search input[type=checkbox]': { margin: '0', accentColor: 'var(--ui-primary)' },
  '.cm-textfield': {
    height: '20px', width: '200px', padding: '0 6px', fontSize: '12px', lineHeight: '18px', fontFamily: 'var(--font-mono)',
    backgroundColor: 'var(--app-surface)', border: '1px solid var(--ui-border-accented)', borderRadius: '4px',
  },
  '.cm-textfield::placeholder': { color: 'var(--ui-text-dimmed)' },
  '.cm-button': {
    height: '20px', padding: '0 8px', fontSize: '12px', lineHeight: '18px', backgroundImage: 'none',
    backgroundColor: 'transparent', border: '1px solid var(--ui-border-accented)', borderRadius: '4px',
  },
  '.cm-button:hover': { backgroundColor: 'var(--app-hover)' },
  '.cm-button:active': { backgroundImage: 'none', backgroundColor: 'var(--ui-bg-accented)' },
  '.cm-textfield:focus-visible, .cm-button:focus-visible': { outline: '2px solid var(--ui-primary)', outlineOffset: '1px' },
  '.cm-panel.cm-search [name=close]': {
    top: '6px', right: '8px', width: '20px', height: '20px', borderRadius: '4px',
    fontSize: '16px', lineHeight: '18px', color: 'var(--ui-text-muted)', cursor: 'default',
  },
  '.cm-panel.cm-search [name=close]:hover': { backgroundColor: 'var(--app-hover)', color: 'var(--ui-text)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in oklab, var(--ui-warning) 30%, transparent)', outline: 'none' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in oklab, var(--ui-primary) 45%, transparent)' },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in oklab, var(--ui-text) 12%, transparent)' },
})

export function glsl() {
  return new LanguageSupport(glslLanguage, [syntaxHighlighting(glslHighlighter), glslHover, signatureHelp, editorTheme])
}
