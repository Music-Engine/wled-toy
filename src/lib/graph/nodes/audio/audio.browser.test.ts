import { describe, expect, it } from 'vitest'
import type { Features } from '@/lib/audio/dsp'
import { AudioTextures } from '@/lib/audio/textures'
import { ShaderRenderer } from '@/lib/engine/render/renderer'
import { FrameRunner, generateGlsl } from '@/lib/graph'
import { graph, node, toByte } from '@/lib/graph/testing'

const BANDS = 16

function features(patch: Partial<Features> = {}): Features {
  return {
    bands: Float32Array.from({ length: BANDS }, (_, i) => i / (BANDS - 1)), spectrum: new Float32Array(1024), waveform: new Float32Array(2048), chroma: Float32Array.from({ length: 12 }, (_, i) => (i === 9 ? 1 : 0)),
    level: 0, gain: 1, rms: 0, peak: 0, gate: true, flux: 0, onset: false, bpm: 120, beatPhase: 0, beat: false, beatConfidence: 0, centroid: 0, flatness: 0,
    ...patch,
  }
}

/** Renders a graph with a scripted audio state: one frame per entry of `script`, returning the first LED's red byte each time. */
function play(doc: ReturnType<typeof graph>, script: Features[], leds = 1): number[][] {
  const shader = generateGlsl(doc)
  expect(shader.error).toBeNull()
  const renderer = new ShaderRenderer(document.createElement('canvas'))
  renderer.compile(shader.code)
  const runner = new FrameRunner()
  runner.load(shader.frame)
  const textures = new AudioTextures(BANDS)
  return script.map((f, frame) => {
    textures.push(new Float32Array(512), f)
    renderer.setAudio(textures)
    renderer.setControls(runner.step({ time: frame / 30, dt: 1 / 30, frameIndex: frame, midi: undefined, osc: undefined, audio: { analyses: [f], sampleRate: 48000 } }))
    const colors = renderer.renderLeds({ time: frame / 30, frame, ledCount: leds, scanY: 0.5 })
    return Array.from({ length: leds }, (_, i) => toByte(colors[i * 3]))
  })
}

describe('Audio node', () => {
  it('its levels drive the shader, through a per-frame chain with state', () => {
    const doc = graph(
      [node('a', 'audio'), node('env', 'envelopeFollower', { attack: 0, release: 0.1 }), node('o', 'output')],
      [['a.level', 'env.signal'], ['env.envelope', 'o.color']],
    )
    const frames = play(doc, [features({ level: 1 }), features({ level: 0 }), features({ level: 0 }), features({ level: 0 })]).map(([r]) => r)
    expect(frames[0]).toBe(255)
    // released, not dropped: each frame is lower than the last, and none is zero yet
    expect(frames[1]).toBeLessThan(255)
    expect(frames[3]).toBeLessThan(frames[2])
    expect(frames[3]).toBeGreaterThan(0)
  })

  it('range outputs follow the spectrum inside their range only', () => {
    const spectrum = new Float32Array(1024)
    spectrum[Math.round(100 / (48000 / 2048))] = 0.25
    const doc = (output: string) => graph([node('a', 'audio'), node('o', 'output')], [[`a.${output}`, 'o.color']])
    expect(play(doc('kick'), [features({ spectrum })])[0][0]).toBe(128)
    expect(play(doc('vocal'), [features({ spectrum })])[0][0]).toBe(0)
    expect(play(doc('kick'), [features({ spectrum, gate: false })])[0][0]).toBe(0)
  })

  it('Band Split reads the range it is given', () => {
    const spectrum = new Float32Array(1024)
    spectrum[Math.round(3000 / (48000 / 2048))] = 1
    const doc = (low: number, high: number) => graph([node('b', 'bandSplit', { low, high }), node('o', 'output')], [['b.level', 'o.color']])
    expect(play(doc(2500, 3500), [features({ spectrum })])[0][0]).toBe(255)
    expect(play(doc(60, 150), [features({ spectrum })])[0][0]).toBe(0)
  })

})

describe('Audio Source and FFT', () => {
  it('an Audio Source sets the input of the graph, linked or not', () => {
    const { frame: plan, error } = generateGlsl(graph([node('s', 'audioSource', { source: 'device', channel: 'left', gateDb: -40 }), node('c', 'color'), node('o', 'output')], [['c.color', 'o.color']]))
    expect(error).toBeNull()
    expect(plan.resources.audioSource).toEqual([{ source: 'device', channel: 'left', agc: { release: 8, floorDb: -50 }, gate: { thresholdDb: -40, hold: 0.3 } }])
  })

  it('a second source with other settings is reported as not live; an identical one is the same source', () => {
    const two = (values: object) => generateGlsl(graph([node('a', 'audioSource'), node('b', 'audioSource', values as never), node('o', 'output')]))
    expect(two({ source: 'device' }).issues).toEqual([{ nodeId: 'b', message: expect.stringContaining('one source runs at a time') }])
    expect(two({}).issues).toEqual([])
  })

  it('FFT nodes get a slot per distinct setting; default settings are slot 0', () => {
    const { frame: plan, code, error } = generateGlsl(graph(
      [node('s', 'audioSource'), node('d', 'fft'), node('f', 'fft', { windowSize: '8192', bands: 32 }), node('g', 'fft', { bands: 32, windowSize: '8192' }),
        node('x', 'spectrum'), node('y', 'spectrum'), node('z', 'chroma'), node('m', 'math', { op: 'add' }), node('n', 'math', { op: 'add' }), node('o', 'output')],
      [['s.audio', 'd.audio'], ['s.audio', 'f.audio'], ['d.spectrum', 'x.spectrum'], ['f.spectrum', 'y.spectrum'], ['g.spectrum', 'z.spectrum'],
        ['x.level', 'm.a'], ['y.level', 'm.b'], ['m.result', 'n.a'], ['z.level', 'n.b'], ['n.result', 'o.color']],
    ))
    expect(error).toBeNull()
    expect(plan.resources.analysis).toEqual([{ windowSize: 8192, hop: 512, window: 'hann', scale: 'mel', bands: 32, fmin: 40, fmax: 16000 }])
    expect(code).toContain('historyAt(0, uv.x, 0.0)')
    expect(code).toContain('historyAt(1, uv.x, 0.0)')
    expect(code).toContain('chromaAt(1,')
  })

  it('a fourth distinct FFT falls back to the default and says so', () => {
    const ffts = [1, 2, 3, 4].map((i) => node(`f${i}`, 'fft', { bands: 12 + i * 4 }))
    const readers = [1, 2, 3, 4].map((i) => node(`r${i}`, 'bandSplit'))
    const sum = [node('m1', 'math', { op: 'add' }), node('m2', 'math', { op: 'add' }), node('m3', 'math', { op: 'add' })]
    const { issues, error } = generateGlsl(graph([...ffts, ...readers, ...sum, node('o', 'output')], [
      ...[1, 2, 3, 4].map((i): [string, string] => [`f${i}.spectrum`, `r${i}.spectrum`]),
      ['r1.level', 'm1.a'], ['r2.level', 'm1.b'], ['r3.level', 'm2.a'], ['r4.level', 'm2.b'], ['m1.result', 'm3.a'], ['m2.result', 'm3.b'], ['m3.result', 'o.color'],
    ]))
    expect(error).toBeNull()
    expect(issues.map((i) => i.nodeId)).toEqual(['f4'])
  })

  it('a sampler reads the textures of the FFT it is linked to', () => {
    const doc = graph([node('f', 'fft', { bands: 16, windowSize: '4096' }), node('x', 'spectrum'), node('o', 'output')], [['f.spectrum', 'x.spectrum'], ['x.level', 'o.color']])
    const shader = generateGlsl(doc)
    const renderer = new ShaderRenderer(document.createElement('canvas'))
    renderer.compile(shader.code)
    const silent = new AudioTextures(BANDS)
    silent.push(new Float32Array(512), features({ bands: new Float32Array(BANDS) }))
    const loud = new AudioTextures(BANDS)
    loud.push(new Float32Array(512), features({ bands: new Float32Array(BANDS).fill(1) }))
    renderer.setAudio(silent, [loud])
    expect(toByte(renderer.renderLeds({ time: 0, frame: 0, ledCount: 1, scanY: 0.5 })[0])).toBe(255)
    renderer.setAudio(loud, [silent])
    expect(toByte(renderer.renderLeds({ time: 0, frame: 0, ledCount: 1, scanY: 0.5 })[0])).toBe(0)
  })

  it('Band Split reads the features of its FFT slot per frame', () => {
    const spectrum = new Float32Array(1024)
    spectrum[Math.round(100 / (48000 / 2048))] = 1
    const { frame: plan } = generateGlsl(graph([node('f', 'fft', { bands: 16 }), node('b', 'bandSplit'), node('o', 'output')], [['f.spectrum', 'b.spectrum'], ['b.level', 'o.color']]))
    const runner = new FrameRunner()
    runner.load(plan)
    const step = (analyses: (Features | null)[]) => runner.step({ time: 0, dt: 1 / 30, frameIndex: 0, midi: undefined, osc: undefined, audio: { analyses, sampleRate: 48000 } })[0]
    expect(step([features(), features({ spectrum })])).toBe(1)
    expect(step([features({ spectrum }), features()])).toBe(0)
    expect(step([features({ spectrum }), null])).toBe(0)
  })

  it('a number cannot be linked into a stream socket, nor a stream into a number', () => {
    const wrongIn = generateGlsl(graph([node('v', 'value'), node('x', 'spectrum'), node('o', 'output')], [['v.value', 'x.spectrum'], ['x.level', 'o.color']]))
    expect(wrongIn).toMatchObject({ errorNode: 'x', error: 'Spectrum needs Spectrum, not Float' })
    const audioIntoSpectrum = generateGlsl(graph([node('s', 'audioSource'), node('x', 'spectrum'), node('o', 'output')], [['s.audio', 'x.spectrum'], ['x.level', 'o.color']]))
    expect(audioIntoSpectrum.error).toBe('Spectrum needs Spectrum, not Audio')
  })
})

describe('samplers', () => {
  it('Spectrum lays the bands along the strip', () => {
    const [leds] = play(graph([node('s', 'spectrum'), node('o', 'output')], [['s.level', 'o.color']]), [features()], BANDS)
    expect(leds).toEqual(Array.from({ length: BANDS }, (_, i) => Math.round((i / (BANDS - 1)) * 255)))
  })

  it('Chroma lights the twelfth of the strip that belongs to the sounding note', () => {
    const [leds] = play(graph([node('c', 'chroma'), node('o', 'output')], [['c.level', 'o.color']]), [features()], 12)
    expect(leds).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0])
  })

  it('Spectrum at age 0 shows the newest hop', () => {
    const quiet = features({ bands: new Float32Array(BANDS) })
    const loud = features({ bands: new Float32Array(BANDS).fill(1) })
    const frames = play(graph([node('s', 'spectrum', { age: 0 }), node('o', 'output')], [['s.level', 'o.color']]), [quiet, loud, quiet])
    expect(frames.map(([r]) => r)).toEqual([0, 255, 0])
  })

  it('Waveform compiles and reads the delay line', () => {
    const frames = play(graph([node('w', 'waveform'), node('o', 'output')], [['w.sample', 'o.color']]), [features()])
    expect(frames[0][0]).toBe(0)
  })
})
