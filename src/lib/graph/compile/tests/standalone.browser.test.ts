import { describe, expect, it } from 'vitest'
import { ShaderRenderer } from '@/lib/engine/render/renderer'
import { createGlslCompiler } from '@/lib/graph/compile/compilers'
import { listCorpusGraphs, listCorpusKinds } from '@/lib/graph/compile/corpus'
import { createDefaultGraph } from '@/lib/graph/model/doc'
import { graph, node, toByte } from '@/lib/graph/testing'

const compileStandalone = createGlslCompiler({ standalone: true }).compile

/** Nothing feeds uniforms or keeps state, as in shader mode; reads one LED */
function renderInShaderMode(code: string, time = 0) {
  const renderer = new ShaderRenderer(document.createElement('canvas'))
  renderer.compile(code)
  const colors = renderer.renderLeds({ time, frame: 0, ledCount: 1, scanY: 0.5 })
  renderer.dispose()
  return [...colors.subarray(0, 3)].map(toByte)
}

describe('standalone code', () => {
  it('the default graph sent to shader mode is not black, reads no uniform slot and loses nothing', () => {
    const { program, issues } = compileStandalone(createDefaultGraph())
    expect(program!.pixel).not.toContain('iControl')
    expect(program!.frame).toBeNull()
    expect(issues).toEqual([])
    expect(Math.max(...renderInShaderMode(program!.pixel, 1.5))).toBeGreaterThan(40)
  })

  it('Time is iTime and the Audio node reads the features shader mode uploads', () => {
    const { program } = compileStandalone(
      graph(
        [node('t', 'time'), node('a', 'audio'), node('m', 'math', { op: 'multiply' }), node('o', 'output')],
        [
          ['t.time', 'm.a'],
          ['a.kick', 'm.b'],
          ['m.result', 'o.color'],
        ],
      ),
    )
    expect(program!.pixel).toMatch(/float n_m = iTime \* iAudioFeatures\[\d\]\.\w;/)
  })

  it('a stateful node keeps no memory, and a knob holds its default, each with an issue on its node', () => {
    const doc = graph(
      [node('k', 'knob', { value: 0.25 }), node('e', 'envelopeFollower'), node('o', 'output')],
      [
        ['k.value', 'e.signal'],
        ['e.envelope', 'o.color'],
      ],
    )
    const { program, issues } = compileStandalone(doc)
    expect(issues).toEqual([
      { nodeId: 'e', message: 'Envelope Follower keeps no memory in the exported shader: its state starts from 0 on every pixel of every frame' },
      { nodeId: 'k', message: 'Knob "Value" is fixed at 0.25 in the exported shader' },
    ])
    expect(program!.pixel).toContain('vec4 state[1];')
    expect(program!.pixel).not.toMatch(/iState|outState\d+ =|iGlobal/)
  })

  it('every graph and kind of the gate corpus compiles in shader mode', () => {
    const renderer = new ShaderRenderer(document.createElement('canvas'))
    for (const [name, doc] of [...listCorpusGraphs(), ...listCorpusKinds()]) {
      const { program } = compileStandalone(doc)
      if (program) expect(() => renderer.compile(program.pixel), name).not.toThrow()
    }
    renderer.dispose()
  })
})
