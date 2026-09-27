import type { GlslChunk } from '@/lib/graph/define/context'
import type { Annotation, PassCode } from '@/lib/graph/compile/context'
import { emitPass, orderChunks } from '@/lib/graph/compile/emit'
import { CPP } from '@/lib/graph/compile/targets/usermod'

// Texture reads, derivatives, samplers and prelude helpers cpp/*.h leaves out; pinned by tests/cpp-parity.test.ts
export const GLSL_ONLY = [
  'texture', 'texelFetch', 'textureSize', 'textureLod', 'textureGrad', 'dFdx', 'dFdy', 'fwidth',
  'iAudio', 'iImage', 'iImages', 'iPrevFrame',
  'previousFrame', 'waveform', 'historyRow', 'chromaAt', 'chroma', 'image', 'imageScroll', 'imagePixelate', 'imageMirror', 'imageZoom', 'imageLuma',
  'audioWave', 'audioChroma', 'audioChromaAt',
]

// Sampler counts wherever named, function only where called, so a local sharing a function's name passes
const SAMPLERS = GLSL_ONLY.filter((name) => /^i[A-Z]/.test(name))
const FUNCTIONS = GLSL_ONLY.filter((name) => !SAMPLERS.includes(name))
// Array constructor (`vec3[6](...)`) has no C++ form in the header either
const NAMES_GLSL_ONLY = new RegExp(`\\b(${SAMPLERS.join('|')})\\b|\\b(${FUNCTIONS.join('|')})\\s*\\(|\\b(float|int|vec[234])\\[\\d*\\]\\s*\\(`)
const isGlslOnly = (code: string) => NAMES_GLSL_ONLY.test(code.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, ''))

/** Emits both passes once w/ C++ spelling into `ctx.cpp`; false where a node's lines or chunks name GLSL-only code */
export const markCppParity = (): Annotation => ({
  name: 'cppParity',
  reads: ['width', 'pass', 'state', 'resources'],
  annotate: (ctx) => {
    ctx.cpp = { frame: emitPass(ctx, CPP, 'frame'), pixel: emitPass(ctx, CPP, 'pixel') }
    const texts = bucketTextsByNode([ctx.cpp.frame, ctx.cpp.pixel])
    for (const id of ctx.order) ctx.nodes[id].cppParity = !(texts.get(id) ?? []).some(isGlslOnly)
  },
})

/** Each node's lines and the source of every chunk it pulled in, requires included, bar prelude ones */
function bucketTextsByNode(passes: PassCode[]): Map<string, string[]> {
  const texts = new Map<string, string[]>()
  const chunks = new Map<string, GlslChunk[]>()
  for (const { lines, includes } of passes) {
    lines.forEach((line) => pushTo(texts, line.node, line.text))
    includes.forEach(({ chunk, node }) => pushTo(chunks, node, chunk))
  }
  for (const [node, included] of chunks) orderChunks(included).filter((chunk) => !chunk.inPrelude).forEach((chunk) => pushTo(texts, node, chunk.source))
  return texts
}

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}
