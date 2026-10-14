import { expect, it } from 'vitest'
import { ShaderRenderer } from '@/lib/engine/render/renderer'
import type { Features } from './dsp'
import { AudioTextures, HISTORY_ROWS } from './textures'

const BANDS = 16

function features(bands: number[], chroma: number[] = []): Features {
  return {
    bands: Float32Array.from(bands),
    spectrum: new Float32Array(1024).fill(0.25),
    waveform: new Float32Array(2048),
    chroma: Float32Array.from({ length: 12 }, (_, i) => chroma[i] ?? 0),
    level: 0,
    gain: 1,
    rms: 0,
    peak: 0,
    gate: true,
    flux: 0,
    onset: false,
    bpm: 120,
    beatPhase: 0,
    beat: false,
    beatConfidence: 0,
    centroid: 0,
    flatness: 0,
  }
}

/** Renders `expr` (a float) as grey on `leds` LEDs and returns the red bytes. */
function probe(audio: AudioTextures, expr: string, leds = BANDS): number[] {
  const renderer = new ShaderRenderer(document.createElement('canvas'))
  renderer.compile(`void mainImage(out vec4 c, vec2 uv, float ledIndex) { c = vec4(vec3(${expr}), 1.0); }`)
  renderer.setAudio(audio)
  const colors = renderer.renderLeds({ time: 0, frame: 0, ledCount: leds, scanY: 0.5 })
  renderer.dispose()
  return Array.from({ length: leds }, (_, i) => Math.round(colors[i * 3] * 255))
}

const ramp = Array.from({ length: BANDS }, (_, i) => i / (BANDS - 1))

it('bands reads each band at its position along the strip', () => {
  const audio = new AudioTextures(BANDS)
  audio.push(new Float32Array(512), features(ramp))
  expect(probe(audio, 'bands(uv.x)')).toEqual(ramp.map((v) => Math.round(v * 255)))
})

it('chroma reads a pitch class by index', () => {
  const audio = new AudioTextures(BANDS)
  audio.push(new Float32Array(512), features(ramp, [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0.5]))
  expect(probe(audio, 'chroma(ledIndex + 8.0)', 4)).toEqual([0, 255, 128, 0])
})

it('history: age 0 is the newest hop, older hops sit further back, and the ring wraps', () => {
  const audio = new AudioTextures(BANDS)
  const flat = (v: number) => Array(BANDS).fill(v)
  // more pushes than rows, so the head has wrapped
  for (let hop = 0; hop < HISTORY_ROWS + 10; hop++) audio.push(new Float32Array(512), features(flat((hop % 5) / 4)))
  const newest = ((HISTORY_ROWS + 9) % 5) / 4
  expect(audio.historyHead).toBe(9)
  expect(probe(audio, 'history(uv.x, 0.0)', 1)[0]).toBe(Math.round(newest * 255))
  const threeBack = ((HISTORY_ROWS + 6) % 5) / 4
  expect(probe(audio, `history(uv.x, 3.0 / ${HISTORY_ROWS - 1}.0)`, 1)[0]).toBe(Math.round(threeBack * 255))
})

it('waveformAt walks back through the samples across hops', () => {
  const audio = new AudioTextures(BANDS)
  audio.push(new Float32Array(512).fill(-1), features(ramp))
  const hop = new Float32Array(512).fill(0)
  hop[511] = 1
  hop[510] = 0.25
  audio.push(hop, features(ramp))
  // the probe clamps to 0..1, so this checks the positive part and the floor; 0.25 is stored as 32/127
  expect(probe(audio, 'waveformAt(ledIndex)', 3)).toEqual([255, 64, 0])
  expect(probe(audio, 'waveformAt(600.0)', 1)).toEqual([0])
})

it('shaders written for the old iAudio layout still get a spectrum', () => {
  const audio = new AudioTextures(BANDS)
  audio.push(new Float32Array(512), features(ramp))
  expect(probe(audio, 'bass()', 1)[0]).toBe(128)
})
