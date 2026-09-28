import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HISTORY_ROWS, MAX_SPECTRUM_BINS, WAVE_ROWS, WAVE_WIDTH } from '@/lib/audio/textures'
import { AUDIO_EXTRA_SLOTS, PRELUDE } from '@/lib/shader/prelude'
import { GLSL_ONLY } from '@/lib/graph/compile/annotations/cpp-parity'
import { createGlslCompiler, createUsermodCompiler } from '@/lib/graph/compile/compilers'
import { listCorpusGraphs, listCorpusKinds } from '@/lib/graph/compile/corpus'

const stripComments = (code: string) => code.replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, '')
const HEADERS = stripComments(['vecmath.h', 'runtime.h', 'prelude.h'].map((file) => readFileSync(`cpp/${file}`, 'utf8')).join('\n'))
const isInHeaders = (name: string) => new RegExp(`\\b${name}\\b`).test(HEADERS)
// Usermod target declares iControl itself; mainImage and main are entry points
const HOSTED = ['iControl', 'mainImage', 'main']

function listPreludeNames(): string[] {
  const functions = [...PRELUDE.matchAll(/^(?:float|int|vec[234]|mat2|bool|void) (\w+)\(/gm)].map((match) => match[1])
  const uniforms = [...PRELUDE.matchAll(/^uniform (?:highp )?\w+\s+(\w+)/gm)].map((match) => match[1])
  return [...functions, ...uniforms]
}

/** Both passes and the standalone shader of every corpus doc */
function listCorpusCode(): string[] {
  return [...listCorpusGraphs(), ...listCorpusKinds()].flatMap(([, doc]) => {
    const live = createGlslCompiler().compile(doc).program
    const standalone = createGlslCompiler({ standalone: true }).compile(doc).program
    return [live?.pixel ?? '', live?.frame?.code ?? '', standalone?.pixel ?? ''].map(stripComments)
  })
}

describe('GLSL_ONLY', () => {
  it('names nothing the C++ headers define', () => {
    expect(GLSL_ONLY.filter(isInHeaders)).toEqual([])
  })

  it('names every prelude function or uniform the headers leave out that a compiled program reads', () => {
    const code = listCorpusCode()
    const missing = listPreludeNames().filter((name) => !HOSTED.includes(name) && !isInHeaders(name) && !GLSL_ONLY.includes(name))
    // A chunk may define a same-named function, which the unit then carries
    const readsFromPrelude = (text: string, name: string) => new RegExp(`\\b${name}\\b`).test(text) && !new RegExp(`^\\w+ ${name}\\(`, 'm').test(text)
    expect(missing.filter((name) => code.some((text) => readsFromPrelude(text, name)))).toEqual([])
  })
})

describe('cpp/runtime.h', () => {
  it('sizes the audio arrays as the GLSL side does', () => {
    const header = readFileSync('cpp/runtime.h', 'utf8')
    const readNumber = (pattern: RegExp) => Number(pattern.exec(header)![1])
    expect(readNumber(/#define WLEDTOY_AUDIO_EXTRA_SLOTS (\d+)/)).toBe(AUDIO_EXTRA_SLOTS)
    expect(readNumber(/constexpr int audioHistoryRows = (\d+);/)).toBe(HISTORY_ROWS)
    expect(readNumber(/#define WLEDTOY_SPECTRUM_BINS (\d+)/)).toBe(MAX_SPECTRUM_BINS)
    expect(/constexpr int audioWaveSamples = (\d+) \* (\d+);/.exec(header)!.slice(1).map(Number)).toEqual([WAVE_WIDTH, WAVE_ROWS])
  })
})

describe('cppParity', () => {
  it('leaves out exactly the kinds whose code reads a texture or a GLSL-only helper, naming the first offender', () => {
    const refused = listCorpusKinds().flatMap(([id, doc]) => {
      const { program, issues } = createUsermodCompiler(1, { checkInputs: false }).compile(doc)
      return program ? [] : [[id, issues.at(-1)] as const]
    })
    expect(refused.map(([id]) => id)).toEqual(['texture', 'chroma', 'trails', 'stripBlur', 'previousFrame', 'imageTexture'])
    expect(refused.find(([id]) => id === 'trails')![1]).toEqual({
      nodeId: 'n',
      message: 'Trails reads a texture or a GLSL-only helper, which a C++ unit has nothing for',
    })
  })
})
