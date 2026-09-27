import { describe, expect, it } from 'vitest'
import type { Features } from '@/lib/audio/dsp'
import { AudioTextures } from '@/lib/audio/textures'
import { ShaderRenderer, type FrameParams } from '@/lib/engine/render/renderer'
import { graph, node } from '@/lib/graph/testing'
import { glslCompiler } from '@/lib/graph/compile/next/compilers'
import { corpusGraphs, corpusKinds } from '@/lib/graph/compile/next/corpus'

const floatTargets = !!document.createElement('canvas').getContext('webgl2')?.getExtension('EXT_color_buffer_float')

describe.skipIf(!floatTargets)('GLSL target programs (needs EXT_color_buffer_float)', () => {
  it('link in WebGL2 as the renderer takes them, the frame pass as a whole shader', () => {
    const renderer = new ShaderRenderer(document.createElement('canvas'))
    const programs = [...corpusGraphs(), ...corpusKinds()].flatMap(([name, doc]) => {
      const program = glslCompiler().compile(doc).program
      return program ? [[name, program] as const] : []
    })
    expect(programs.filter(([, program]) => program.frame).length).toBeGreaterThan(0)
    for (const [name, { pixel, frame }] of programs) expect(() => renderer.compile(pixel, frame ?? undefined), name).not.toThrow()
    renderer.dispose()
  })

  it('computes a value in the frame pass on the LED tick that the LED pass reads from global state', () => {
    const doc = graph([node('t', 'time'), node('m', 'math', { op: 'multiply', b: 0.25 }), node('o', 'output')], [['t.time', 'm.a'], ['m.result', 'o.color']])
    const program = glslCompiler().compile(doc).program!
    expect(program.frame).not.toBeNull()
    const renderer = new ShaderRenderer(document.createElement('canvas'))
    renderer.compile(program.pixel, program.frame!)
    const params: FrameParams = { time: 2, frame: 0, ledCount: 4, scanY: 0.5 }
    renderer.renderGlobalState(params)
    const leds = renderer.renderLeds(params)
    expect(Array.from(leds).map((channel) => Math.round(channel * 255))).toEqual(new Array(12).fill(128))
    renderer.dispose()
  })

  it('reads the features and the bands setAudio uploaded in the frame pass', () => {
    const doc = graph(
      [node('a', 'audio'), node('b', 'bands', { count: '16' }), node('c', 'combineXYZ'), node('o', 'output')],
      [['a.level', 'c.x'], ['a.beat', 'c.y'], ['b.band2', 'c.z'], ['c.vector', 'o.color']],
    )
    const program = glslCompiler().compile(doc).program!
    const textures = new AudioTextures(64)
    textures.bands[6] = 200
    const renderer = new ShaderRenderer(document.createElement('canvas'))
    renderer.compile(program.pixel, program.frame!)
    renderer.setAudio(textures, [], { level: 0.5, beat: true, gate: false } as Features)
    const params: FrameParams = { time: 0, frame: 0, ledCount: 1, scanY: 0.5 }
    renderer.renderGlobalState(params)
    expect(Array.from(renderer.renderLeds(params)).map((channel) => Math.round(channel * 255))).toEqual([128, 255, 200])
    renderer.dispose()
  })
})
