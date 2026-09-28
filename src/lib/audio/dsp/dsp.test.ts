import { describe, expect, it } from 'vitest'
import { Agc, Analyzer, DEFAULT_ANALYZER, Fft, Filterbank, RingRows, SampleRing, SilenceGate, centroid, chroma, createWindow, flatness, fromDb, rms } from '.'

const RATE = 48000

const sine = (hz: number, length: number, amplitude = 1, rate = RATE) =>
  Float32Array.from({ length }, (_, i) => amplitude * Math.sin((2 * Math.PI * hz * i) / rate))

// a deterministic generator, so a "noise" test cannot fail one run in a thousand
function noise(length: number, amplitude = 1, seed = 1): Float32Array {
  let x = seed
  return Float32Array.from({ length }, () => {
    x = (x * 1664525 + 1013904223) % 4294967296
    return amplitude * (x / 2147483648 - 1)
  })
}

function spectrumOf(samples: Float32Array): Float32Array {
  const window = createWindow('hann', samples.length)
  const windowed = samples.map((s, i) => s * window[i])
  return new Fft(samples.length).magnitudes(windowed, 2 / window.reduce((a, b) => a + b, 0), new Float32Array(samples.length / 2))
}

describe('Fft', () => {
  it('puts a 1 kHz sine in the bin that holds 1 kHz, at amplitude 1', () => {
    const spectrum = spectrumOf(sine(1000, 2048))
    const loudest = spectrum.indexOf(Math.max(...spectrum))
    expect(loudest).toBe(Math.round(1000 / (RATE / 2048)))
    expect(spectrum[loudest]).toBeGreaterThan(0.85)
    expect(spectrum[loudest]).toBeLessThanOrEqual(1.001)
  })

  it('conserves energy (Parseval) for an unwindowed signal', () => {
    const samples = noise(1024, 0.5)
    const spectrum = new Fft(1024).magnitudes(samples, 1, new Float32Array(512))
    // bins 1..N/2-1 appear twice in the full transform; DC and Nyquist once (Nyquist is not returned, and is tiny here)
    const frequencyEnergy = (spectrum[0] ** 2 + 2 * spectrum.slice(1).reduce((a, m) => a + m * m, 0)) / 1024
    const timeEnergy = samples.reduce((a, s) => a + s * s, 0)
    expect(frequencyEnergy / timeEnergy).toBeCloseTo(1, 2)
  })

  it('rejects sizes that are not a power of two', () => {
    expect(() => new Fft(1000)).toThrow(/power of two/)
  })
})

describe('Filterbank', () => {
  it.each(['mel', 'log'] as const)('%s: a sine lands in the band around its frequency and at most its neighbors', (scale) => {
    const bank = new Filterbank({ bands: 32, scale, fmin: 40, fmax: 16000 }, RATE, 2048)
    const bands = bank.apply(spectrumOf(sine(1000, 2048)), new Float32Array(32))
    const loudest = bands.indexOf(Math.max(...bands))
    expect(loudest).toBe(bank.bandAt(1000))
    const lit = [...bands].map((b, i) => (b > 0.1 ? i : -1)).filter((i) => i >= 0)
    expect(lit.every((i) => Math.abs(i - loudest) <= 1)).toBe(true)
  })

  it('covers the configured range with as many bands as asked, low ones included', () => {
    const bank = new Filterbank({ bands: 64, scale: 'log', fmin: 40, fmax: 16000 }, RATE, 2048)
    expect(bank.centers).toHaveLength(64)
    expect(bank.centers[0]).toBeGreaterThan(40)
    expect(bank.centers[63]).toBeLessThan(16000)
    // even where bands are narrower than an FFT bin, a bass tone must light something
    const bands = bank.apply(spectrumOf(sine(60, 2048)), new Float32Array(64))
    expect(Math.max(...bands.slice(0, 8))).toBeGreaterThan(0.3)
  })
})

describe('Agc', () => {
  it('maps a quiet input and a loud one to the same level, at once when it gets louder', () => {
    const agc = new Agc({ release: 2, floorDb: -60 })
    const dt = 0.01
    let quiet = 0
    for (let i = 0; i < 300; i++) quiet = fromDb(-40) * agc.gain(fromDb(-40), dt)
    const loud = fromDb(-6) * agc.gain(fromDb(-6), dt)
    expect(quiet).toBeCloseTo(1, 3)
    expect(loud).toBeCloseTo(1, 3)
  })

  it('recovers within a few release times after the input drops, and never boosts below the floor', () => {
    const agc = new Agc({ release: 1, floorDb: -50 })
    agc.gain(fromDb(-6), 0.01)
    let level = 0
    for (let i = 0; i < 500; i++) level = fromDb(-40) * agc.gain(fromDb(-40), 0.01)
    expect(level).toBeCloseTo(1, 1)
    expect(fromDb(-70) * new Agc({ release: 1, floorDb: -50 }).gain(fromDb(-70), 0.01)).toBeCloseTo(0.1, 2)
  })
})

describe('SilenceGate', () => {
  it('stays open through a gap shorter than its hold and closes after a longer one', () => {
    const gate = new SilenceGate(-50, 0.3)
    expect(gate.open(0.1, 0.01)).toBe(true)
    let open = true
    for (let i = 0; i < 20; i++) open = gate.open(0, 0.01)
    expect(open).toBe(true)
    for (let i = 0; i < 20; i++) open = gate.open(0, 0.01)
    expect(open).toBe(false)
  })
})

describe('spectral shape', () => {
  it('chroma: A4 peaks at pitch class A, C5 at C', () => {
    const classes = (hz: number) => chroma(spectrumOf(sine(hz, 4096)), RATE, 4096, 55, 5000, new Float32Array(12))
    expect(classes(440).indexOf(1)).toBe(9)
    expect(classes(523.25).indexOf(1)).toBe(0)
  })

  it('chroma counts nothing below its low bound, so a kick can be left out', () => {
    // a 60 Hz kick (near B1) over a quieter A4
    const mix = sine(60, 4096).map((s, i) => s + 0.3 * Math.sin((2 * Math.PI * 440 * i) / RATE))
    const classes = (lowHz: number) => chroma(spectrumOf(mix), RATE, 4096, lowHz, 5000, new Float32Array(12))
    expect(classes(40).indexOf(1)).not.toBe(9)
    expect(classes(100).indexOf(1)).toBe(9)
  })

  it('flatness separates a tone from noise; centroid rises with pitch', () => {
    expect(flatness(spectrumOf(sine(1000, 2048)))).toBeLessThan(0.1)
    expect(flatness(spectrumOf(noise(2048)))).toBeGreaterThan(0.5)
    const bright = (hz: number) => centroid(spectrumOf(sine(hz, 2048)), RATE, 2048)
    expect(bright(200)).toBeLessThan(bright(2000))
    expect(bright(2000)).toBeLessThan(bright(10000))
  })
})

describe('rings', () => {
  it('RingRows returns rows newest first and wraps', () => {
    const ring = new RingRows(2, 3)
    for (let i = 1; i <= 4; i++) ring.push(Float32Array.of(i, i * 10))
    expect([...ring.row(0)]).toEqual([4, 40])
    expect([...ring.row(2)]).toEqual([2, 20])
    expect(ring.head).toBe(1)
  })

  it('SampleRing reads the newest samples, or older ones with a delay', () => {
    const ring = new SampleRing(8)
    ring.push(Float32Array.from({ length: 11 }, (_, i) => i))
    expect([...ring.read(new Float32Array(3))]).toEqual([8, 9, 10])
    expect([...ring.read(new Float32Array(3), 4)]).toEqual([4, 5, 6])
  })
})

describe('Analyzer', () => {
  const config = { ...DEFAULT_ANALYZER, sampleRate: RATE }

  /** A click track: short decaying noise bursts at `bpm`, with a quiet bed so the gate stays open. */
  function clicks(bpm: number, seconds: number): Float32Array {
    const out = noise(Math.round(seconds * RATE), 0.002, 7)
    const period = (60 / bpm) * RATE
    const burst = noise(2400, 0.8, 3)
    for (let beat = 0; beat * period < out.length; beat++) {
      const start = Math.round(beat * period)
      for (let i = 0; i < burst.length && start + i < out.length; i++) out[start + i] += burst[i] * Math.exp(-i / 400)
    }
    return out
  }

  function run(samples: Float32Array, each: (features: ReturnType<Analyzer['process']>, time: number) => void) {
    const analyzer = new Analyzer(config)
    for (let start = 0; start + config.hop <= samples.length; start += config.hop) {
      each(analyzer.process(samples.subarray(start, start + config.hop)), (start + config.hop) / RATE)
    }
  }

  it.each([120, 90, 140])('finds %i BPM within six seconds and keeps its beat clock on the clicks', (bpm) => {
    const beats: number[] = []
    let reported = 0
    run(clicks(bpm, 12), (f, time) => {
      if (time >= 6 && time < 6.1) reported = f.bpm
      if (time >= 8 && f.beat) beats.push(time)
    })
    expect(reported).toBeGreaterThan(bpm * 0.98)
    expect(reported).toBeLessThan(bpm * 1.02)

    const period = 60 / bpm
    // distance from each reported beat to the nearest click; one hop of detection latency is inherent
    const errors = beats.map((t) => Math.abs(((t + period / 2) % period) - period / 2))
    expect(beats.length).toBeGreaterThanOrEqual(Math.floor(4 / period) - 1)
    expect(Math.max(...errors)).toBeLessThan(0.03 + config.hop / RATE)
  })

  it('reports onsets on the clicks and none in between', () => {
    const onsets: number[] = []
    run(clicks(120, 6), (f, time) => f.onset && time > 1 && onsets.push(time))
    expect(onsets.length).toBeGreaterThanOrEqual(9)
    expect(onsets.every((t) => t % 0.5 < 0.08)).toBe(true)
  })

  it('gives the same band picture for a loud and a quiet copy of the same sound', () => {
    const picture = (amplitude: number) => {
      let bands: number[] = []
      run(sine(440, RATE * 2, amplitude), (f) => (bands = [...f.bands]))
      return bands
    }
    const [loud, quiet] = [picture(0.5), picture(0.01)]
    expect(Math.max(...quiet)).toBeCloseTo(Math.max(...loud), 2)
    expect(quiet.indexOf(Math.max(...quiet))).toBe(loud.indexOf(Math.max(...loud)))
  })

  it('closes the gate on silence and zeroes what depends on it', () => {
    let last = { gate: true, level: 1, bands: new Float32Array(1).fill(1) as Float32Array }
    run(new Float32Array(RATE), (f) => (last = { gate: f.gate, level: f.level, bands: f.bands }))
    expect(last.gate).toBe(false)
    expect(last.level).toBe(0)
    expect(Math.max(...last.bands)).toBe(0)
  })

  it('level tracks rms', () => {
    expect(rms(sine(100, 4800, 0.5))).toBeCloseTo(0.5 / Math.SQRT2, 3)
  })
})
