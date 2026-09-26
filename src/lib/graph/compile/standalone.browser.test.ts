import { describe, expect, it } from 'vitest'
import { ShaderRenderer } from '@/lib/engine/render/renderer'
import { generateGlsl } from './compile'
import { createDefaultGraph } from '@/lib/graph/model/doc'
import { graph, node, toByte } from '@/lib/graph/testing'

/** Compiles code with nothing feeding the uniform block, the way shader mode does, and reads one LED. */
function shaderMode(code: string, time = 0) {
  const renderer = new ShaderRenderer(document.createElement('canvas'))
  renderer.compile(code)
  const colors = renderer.renderLeds({ time, frame: 0, ledCount: 1, scanY: 0.5 })
  renderer.dispose()
  return [...colors.subarray(0, 3)].map(toByte)
}

describe('standalone code', () => {
  it('the default graph sent to shader mode is not black and reads no uniform slot', () => {
    const live = generateGlsl(createDefaultGraph())
    const sent = generateGlsl(createDefaultGraph(), { standalone: true, controls: () => 0.6 })
    expect(live.code).toContain('iControl')
    expect(sent.code).not.toContain('iControl')
    expect(sent.error).toBeNull()
    expect(sent.frame.exports).toEqual([])
    expect(Math.max(...shaderMode(sent.code, 1.5))).toBeGreaterThan(40)
  })

  it('Time becomes iTime and the Audio node its prelude helpers', () => {
    const { code } = generateGlsl(graph([node('t', 'time'), node('a', 'audio'), node('m', 'math', { op: 'multiply' }), node('o', 'output')], [['t.time', 'm.a'], ['a.kick', 'm.b'], ['m.result', 'o.color']]), { standalone: true })
    expect(code).toContain('iTime * bass()')
  })

  it('a per-frame node with no GLSL is frozen at its last value, with a comment saying so', () => {
    const doc = graph([node('k', 'knob'), node('e', 'envelopeFollower'), node('o', 'output')], [['k.value', 'e.signal'], ['e.envelope', 'o.color']])
    const { code, error } = generateGlsl(doc, { standalone: true, controls: (id, output) => (id === 'e' && output === 'envelope' ? 0.25 : undefined) })
    expect(error).toBeNull()
    expect(code).toContain('// Envelope Follower "Envelope" runs per frame; frozen at 0.25 when this code was taken')
    expect(shaderMode(code)).toEqual([64, 64, 64])
  })

  it('a stream link still resolves, and a Knob with no recorded value bakes as 0', () => {
    const { code, error } = generateGlsl(graph([node('k', 'knob'), node('o', 'output')], [['k.value', 'o.color']]), { standalone: true })
    expect(error).toBeNull()
    expect(code).toContain('frozen at 0.0')
  })
})
