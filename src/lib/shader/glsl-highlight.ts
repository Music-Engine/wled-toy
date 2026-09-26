import { StreamLanguage, type StreamParser } from '@codemirror/language'
import { highlightCode, tagHighlighter, tags as t, Tag } from '@lezer/highlight'
import { GLSL_EXTRA_BUILTINS, GLSL_KEYWORDS, GLSL_TYPES, NODES, nodeByName } from './catalog'

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

export const glslLanguage = StreamLanguage.define(parser)

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
