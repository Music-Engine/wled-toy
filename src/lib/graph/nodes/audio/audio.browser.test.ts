import { describe, expect, it } from 'vitest'
import type { Features } from '@/lib/audio/dsp'
import { AudioTextures } from '@/lib/audio/textures'
import { ShaderRenderer } from '@/lib/engine/render/renderer'
import { Runtime } from '@/lib/engine/runtime'
import { createGlslCompiler } from '@/lib/graph'
import { graph, node, toByte } from '@/lib/graph/testing'

const BANDS = 16

function makeFeatures(patch: Partial<Features> = {}): Features {
  return {
    bands: Float32Array.from({ length: BANDS }, (_, i) => i / (BANDS - 1)), spectrum: new Float32Array(1024), waveform: new Float32Array(2048), chroma: Float32Array.from({ length: 12 }, (_, i) => (i === 9 ? 1 : 0)),
    level: 0, gain: 1, rms: 0, peak: 0, gate: true, flux: 0, onset: false, bpm: 120, beatPhase: 0, beat: false, beatConfidence: 0, centroid: 0, flatness: 0,
    ...patch,
  }
}

/** Frame per `script` entry, fed and pushed into the default analysis; red byte of every LED per frame */
function play(doc: ReturnType<typeof graph>, script: Features[], leds = 1, extra: AudioTextures[] = []): number[][] {
  const { program, slots, issues } = createGlslCompiler().compile(doc)
  expect(issues).toEqual([])
  const renderer = new ShaderRenderer(document.createElement('canvas'))
  const runtime = new Runtime(renderer)
  runtime.load(program!, slots)
  const textures = new AudioTextures(BANDS)
  const frames = script.map((f, frame) => {
    textures.push(new Float32Array(512), f)
    renderer.setAudio(textures, extra, f)
    const colors = runtime.tick({ time: frame / 30, dt: 1 / 30, frame, ledCount: leds, scanY: 0.5 })
    return Array.from({ length: leds }, (_, i) => toByte(colors[i * 3]))
  })
  renderer.dispose()
  return frames
}

describe('Audio node', () => {
  it('its levels drive the shader, through a per-frame chain with state', () => {
    const doc = graph(
      [node('a', 'audio'), node('env', 'envelopeFollower', { attack: 0, release: 0.1 }), node('o', 'output')],
      [['a.level', 'env.signal'], ['env.envelope', 'o.color']],
    )
    const frames = play(doc, [makeFeatures({ level: 1 }), makeFeatures({ level: 0 }), makeFeatures({ level: 0 }), makeFeatures({ level: 0 })]).map(([r]) => r)
    expect(frames[0]).toBe(255)
    // Released, not dropped
    expect(frames[1]).toBeLessThan(255)
    expect(frames[3]).toBeLessThan(frames[2])
    expect(frames[3]).toBeGreaterThan(0)
  })

  it('range outputs follow the spectrum inside their range only', () => {
    const spectrum = new Float32Array(1024)
    spectrum[Math.round(100 / (48000 / 2048))] = 0.25
    const buildDoc = (output: string) => graph([node('a', 'audio'), node('o', 'output')], [[`a.${output}`, 'o.color']])
    expect(play(buildDoc('kick'), [makeFeatures({ spectrum })])[0][0]).toBe(128)
    expect(play(buildDoc('vocal'), [makeFeatures({ spectrum })])[0][0]).toBe(0)
    expect(play(buildDoc('kick'), [makeFeatures({ spectrum, gate: false })])[0][0]).toBe(0)
  })

  it('Band Split reads the range it is given', () => {
    const spectrum = new Float32Array(1024)
    spectrum[Math.round(3000 / (48000 / 2048))] = 1
    const buildDoc = (low: number, high: number) => graph([node('b', 'bandSplit', { low, high }), node('o', 'output')], [['b.level', 'o.color']])
    expect(play(buildDoc(2500, 3500), [makeFeatures({ spectrum })])[0][0]).toBe(255)
    expect(play(buildDoc(60, 150), [makeFeatures({ spectrum })])[0][0]).toBe(0)
  })
})

describe('Audio Source and FFT', () => {
  it('an Audio Source sets the input of the graph, linked or not', () => {
    const { program, issues } = createGlslCompiler().compile(graph([node('s', 'audioSource', { source: 'device', channel: 'left', gateDb: -40 }), node('c', 'color'), node('o', 'output')], [['c.color', 'o.color']]))
    expect(issues).toEqual([])
    expect(program!.resources.audioSource).toEqual([{ source: 'device', channel: 'left', agc: { release: 8, floorDb: -50 }, gate: { thresholdDb: -40, hold: 0.3 } }])
  })

  it('a second source with other settings is reported as not live; an identical one is the same source', () => {
    const compileSources = (values: object) => createGlslCompiler().compile(graph([node('a', 'audioSource'), node('b', 'audioSource', values as never), node('o', 'output')]))
    expect(compileSources({ source: 'device' }).issues).toEqual([{ nodeId: 'b', message: expect.stringContaining('one source runs at a time') }])
    expect(compileSources({}).issues).toEqual([])
  })

  it('FFT nodes get a slot per distinct setting; default settings are slot 0', () => {
    const { program, issues } = createGlslCompiler().compile(graph(
      [node('s', 'audioSource'), node('d', 'fft'), node('f', 'fft', { windowSize: '8192', bands: 32 }), node('g', 'fft', { bands: 32, windowSize: '8192' }),
        node('x', 'spectrum'), node('y', 'spectrum'), node('z', 'chroma'), node('m', 'math', { op: 'add' }), node('n', 'math', { op: 'add' }), node('o', 'output')],
      [['s.audio', 'd.audio'], ['s.audio', 'f.audio'], ['d.spectrum', 'x.spectrum'], ['f.spectrum', 'y.spectrum'], ['g.spectrum', 'z.spectrum'],
        ['x.level', 'm.a'], ['y.level', 'm.b'], ['m.result', 'n.a'], ['z.level', 'n.b'], ['n.result', 'o.color']],
    ))
    expect(issues).toEqual([])
    expect(program!.resources.analysis).toEqual([{ windowSize: 8192, hop: 512, window: 'hann', scale: 'mel', bands: 32, fmin: 40, fmax: 16000 }])
    expect(program!.pixel).toContain('historyAt(0, uv.x, 0.0)')
    expect(program!.pixel).toContain('historyAt(1, uv.x, 0.0)')
    expect(program!.pixel).toContain('chromaAt(1,')
  })

  it('a fourth distinct FFT falls back to the default and says so', () => {
    const ffts = [1, 2, 3, 4].map((i) => node(`f${i}`, 'fft', { bands: 12 + i * 4 }))
    const readers = [1, 2, 3, 4].map((i) => node(`r${i}`, 'bandSplit'))
    const sum = [node('m1', 'math', { op: 'add' }), node('m2', 'math', { op: 'add' }), node('m3', 'math', { op: 'add' })]
    const { program, issues } = createGlslCompiler().compile(graph([...ffts, ...readers, ...sum, node('o', 'output')], [
      ...[1, 2, 3, 4].map((i): [string, string] => [`f${i}.spectrum`, `r${i}.spectrum`]),
      ['r1.level', 'm1.a'], ['r2.level', 'm1.b'], ['r3.level', 'm2.a'], ['r4.level', 'm2.b'], ['m1.result', 'm3.a'], ['m2.result', 'm3.b'], ['m3.result', 'o.color'],
    ]))
    expect(program).not.toBeNull()
    expect(issues.map((i) => i.nodeId)).toEqual(['f4'])
  })

  it('a sampler reads the textures of the FFT it is linked to', () => {
    const doc = graph([node('f', 'fft', { bands: 16, windowSize: '4096' }), node('x', 'spectrum'), node('o', 'output')], [['f.spectrum', 'x.spectrum'], ['x.level', 'o.color']])
    const { program } = createGlslCompiler().compile(doc)
    const renderer = new ShaderRenderer(document.createElement('canvas'))
    renderer.compile(program!.pixel)
    const silent = new AudioTextures(BANDS)
    silent.push(new Float32Array(512), makeFeatures({ bands: new Float32Array(BANDS) }))
    const loud = new AudioTextures(BANDS)
    loud.push(new Float32Array(512), makeFeatures({ bands: new Float32Array(BANDS).fill(1) }))
    renderer.setAudio(silent, [loud])
    expect(toByte(renderer.renderLeds({ time: 0, frame: 0, ledCount: 1, scanY: 0.5 })[0])).toBe(255)
    renderer.setAudio(loud, [silent])
    expect(toByte(renderer.renderLeds({ time: 0, frame: 0, ledCount: 1, scanY: 0.5 })[0])).toBe(0)
  })

  it('Band Split reads the spectrum of its FFT slot', () => {
    const spectrum = new Float32Array(1024)
    spectrum[Math.round(100 / (48000 / 2048))] = 1
    const doc = graph([node('f', 'fft', { bands: 16 }), node('b', 'bandSplit'), node('o', 'output')], [['f.spectrum', 'b.spectrum'], ['b.level', 'o.color']])
    const pushInto = (f: Features) => {
      const textures = new AudioTextures(BANDS)
      textures.push(new Float32Array(512), f)
      return textures
    }
    expect(play(doc, [makeFeatures()], 1, [pushInto(makeFeatures({ spectrum }))])[0][0]).toBe(255)
    expect(play(doc, [makeFeatures({ spectrum })], 1, [pushInto(makeFeatures())])[0][0]).toBe(0)
    // Slot the analysis hasn't reached has no bins
    expect(play(doc, [makeFeatures({ spectrum })], 1, [new AudioTextures(BANDS)])[0][0]).toBe(0)
  })

  it('a number cannot be linked into a stream socket, nor a stream into a number', () => {
    const wrongIn = createGlslCompiler().compile(graph([node('v', 'value'), node('x', 'spectrum'), node('o', 'output')], [['v.value', 'x.spectrum'], ['x.level', 'o.color']]))
    expect(wrongIn.program).toBeNull()
    expect(wrongIn.issues.at(-1)).toEqual({ nodeId: 'x', message: 'Spectrum needs Spectrum, not Float' })
    const audioIntoSpectrum = createGlslCompiler().compile(graph([node('s', 'audioSource'), node('x', 'spectrum'), node('o', 'output')], [['s.audio', 'x.spectrum'], ['x.level', 'o.color']]))
    expect(audioIntoSpectrum.issues.at(-1)?.message).toBe('Spectrum needs Spectrum, not Audio')
  })
})

describe('samplers', () => {
  it('Spectrum lays the bands along the strip', () => {
    const [leds] = play(graph([node('s', 'spectrum'), node('o', 'output')], [['s.level', 'o.color']]), [makeFeatures()], BANDS)
    expect(leds).toEqual(Array.from({ length: BANDS }, (_, i) => Math.round((i / (BANDS - 1)) * 255)))
  })

  it('Chroma lights the twelfth of the strip that belongs to the sounding note', () => {
    const [leds] = play(graph([node('c', 'chroma'), node('o', 'output')], [['c.level', 'o.color']]), [makeFeatures()], 12)
    expect(leds).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0])
  })

  it('Spectrum at age 0 shows the newest hop', () => {
    const quiet = makeFeatures({ bands: new Float32Array(BANDS) })
    const loud = makeFeatures({ bands: new Float32Array(BANDS).fill(1) })
    const frames = play(graph([node('s', 'spectrum', { age: 0 }), node('o', 'output')], [['s.level', 'o.color']]), [quiet, loud, quiet])
    expect(frames.map(([r]) => r)).toEqual([0, 255, 0])
  })

  it('Waveform compiles and reads the delay line', () => {
    const frames = play(graph([node('w', 'waveform'), node('o', 'output')], [['w.sample', 'o.color']]), [makeFeatures()])
    expect(frames[0][0]).toBe(0)
  })
})
