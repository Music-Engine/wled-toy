import { PRELUDE } from './prelude'
import { UNIFORM_CONTRACT } from './prelude/uniform-contract'

export { UNIFORM_CONTRACT } from './prelude/uniform-contract'

interface Chunk {
  kind: 'uniform' | 'function'
  name: string
  text: string
}

/** Fragment shader compiling outside this app: uniforms and prelude helpers the code reaches, the code, and `main` */
export function bundleShader(code: string, title = 'Untitled'): string {
  const chunks = listPreludeChunks()
  const main = chunks.find((chunk) => chunk.name === 'main')!
  const used = collectReachedChunks(chunks, [...listIdentifiers(code), ...listIdentifiers(main.text)])
  const uniforms = chunks.filter((chunk) => chunk.kind === 'uniform' && used.has(chunk))
  const helpers = chunks.filter((chunk) => chunk.kind === 'function' && chunk !== main && used.has(chunk))
  return [
    ...writeHeader(title, uniforms),
    'precision highp float;',
    '',
    ...uniforms.map((uniform) => uniform.text),
    '',
    'out vec4 outColor;',
    '',
    ...helpers.map((helper) => helper.text),
    '',
    code.trim(),
    '',
    main.text,
    '',
  ].join('\n')
}

/** Prelude uniforms and function definitions in source order, each function w/ the comment above it */
function listPreludeChunks(): Chunk[] {
  const chunks: Chunk[] = []
  const lines = PRELUDE.split('\n')
  let comments: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('//')) {
      comments.push(lines[i])
      continue
    }
    const uniform = /^uniform\s+(?:highp\s+)?\w+\s+(\w+)/.exec(lines[i])
    const definition = /^\w+\s+(\w+)\s*\([^)]*\)\s*\{/.exec(lines[i])
    if (uniform) chunks.push({ kind: 'uniform', name: uniform[1], text: lines[i] })
    if (definition) {
      let text = lines[i]
      while (countOpenBraces(text) > 0) text += `\n${lines[++i]}`
      chunks.push({ kind: 'function', name: definition[1], text: [...comments, text].join('\n') })
    }
    comments = []
  }
  return chunks
}

/** Chunks named from `pending`, and what their functions name in turn */
function collectReachedChunks(chunks: Chunk[], pending: string[]): Set<Chunk> {
  const byName = new Map(chunks.map((chunk) => [chunk.name, chunk]))
  const used = new Set<Chunk>()
  while (pending.length) {
    const chunk = byName.get(pending.pop()!)
    if (!chunk || used.has(chunk)) continue
    used.add(chunk)
    if (chunk.kind === 'function') pending.push(...listIdentifiers(chunk.text))
  }
  return used
}

function writeHeader(title: string, uniforms: Chunk[]): string[] {
  const width = Math.max(...uniforms.map((uniform) => uniform.name.length))
  return [
    '#version 300 es',
    `// ${title}`,
    '// A standalone fragment shader exported from WLEDtoy. It needs nothing else to compile as GLSL ES 3.00 (WebGL2, OpenGL ES 3).',
    '//',
    '// Running it: draw one triangle or quad that covers the whole target. Only gl_FragCoord is read, so the vertex shader',
    '// passes nothing on. The color leaves through outColor. mainImage gets uv from 0 to 1 with the origin at the bottom left,',
    '// and the index of the LED the pixel belongs to.',
    '//',
    '// Uniforms the host sets. One left alone reads 0, and samplers of different types must not share a texture unit.',
    ...uniforms.map((uniform) => `//   ${uniform.name.padEnd(width)}  ${UNIFORM_CONTRACT[uniform.name]}`),
  ]
}

export const stripComments = (code: string) => code.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')
const listIdentifiers = (code: string) => stripComments(code).match(/[A-Za-z_]\w*/g) ?? []
const countOpenBraces = (text: string) => text.split('{').length - text.split('}').length
