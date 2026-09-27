import { BREAKDOWN, FPS, SECONDS, findSection } from '@/lib/graph/testing/offline'
import type { Run } from './run'

export function computeStats(run: Run, notes: string[], stripLeds: number, matrixSide: number) {
  const strip = summarizeFrames(run.strip)
  const matrix = summarizeFrames(run.matrix)
  const times = run.audio.map((_, frame) => frame / FPS)
  const findBestLag = (signal: number[]) => {
    const byLag = Array.from({ length: 7 }, (_, lag) => computeCorrelation(strip.brightness, signal, lag))
    const lag = byLag.indexOf(Math.max(...byLag))
    return { atLag0: roundToMillis(byLag[0]), best: roundToMillis(byLag[lag]), bestLagFrames: lag }
  }
  return {
    fps: FPS,
    frames: run.strip.length,
    stripLeds,
    matrix: `${matrixSide}x${matrixSide}`,
    sections: { groove: [0, BREAKDOWN[0]], breakdown: BREAKDOWN, drop: [BREAKDOWN[1], SECONDS] },
    summary: {
      meanBrightness: roundToMillis(computeMean(strip.brightness)),
      minBrightness: roundToMillis(Math.min(...strip.brightness)),
      maxBrightness: roundToMillis(Math.max(...strip.brightness)),
      meanBrightnessBySection: Object.fromEntries(['groove', 'breakdown', 'drop'].map((name) => [name, roundToMillis(computeMean(strip.brightness.filter((_, i) => findSection(times[i]) === name)))])),
      meanFrameDelta: roundToMillis(computeMean(strip.delta)),
      blackLedFraction: roundToMillis(strip.blackFraction),
      whiteLedFraction: roundToMillis(strip.whiteFraction),
      brightnessVsLevel: findBestLag(run.audio.map((audio) => audio.level)),
      brightnessVsKick: findBestLag(run.audio.map((audio) => audio.kick)),
      matrixMeanBrightness: roundToMillis(computeMean(matrix.brightness)),
      matrixBlackLedFraction: roundToMillis(matrix.blackFraction),
      matrixWhiteLedFraction: roundToMillis(matrix.whiteFraction),
      beatsDetected: run.audio.filter((audio) => audio.beat).length,
    },
    warnings: notes,
    perFrame: {
      time: times.map(roundToMillis),
      brightness: strip.brightness.map(roundToMillis),
      delta: strip.delta.map(roundToMillis),
      audioLevel: run.audio.map((audio) => roundToMillis(audio.level)),
      audioKick: run.audio.map((audio) => roundToMillis(audio.kick)),
    },
  }
}

function summarizeFrames(frames: Float32Array[]) {
  const brightness = frames.map((leds) => computeMean([...leds].map((channel) => Math.min(1, Math.max(0, channel)))))
  const delta = frames.map((leds, i) => (i === 0 ? 0 : computeMean([...leds].map((channel, k) => Math.abs(channel - frames[i - 1][k])))))
  let black = 0
  let white = 0
  for (const leds of frames) {
    for (let i = 0; i < leds.length; i += 3) {
      if (Math.max(leds[i], leds[i + 1], leds[i + 2]) < 0.02) black++
      if (Math.min(leds[i], leds[i + 1], leds[i + 2]) > 0.98) white++
    }
  }
  const ledSamples = frames.length * frames[0].length / 3
  return { brightness, delta, blackFraction: black / ledSamples, whiteFraction: white / ledSamples }
}

/** Pearson correlation of `a` against `b` delayed `lag` frames; 0 when either is constant */
function computeCorrelation(a: number[], b: number[], lag = 0): number {
  const x = a.slice(lag)
  const y = b.slice(0, b.length - lag)
  const [meanX, meanY] = [computeMean(x), computeMean(y)]
  const covariance = computeMean(x.map((v, i) => (v - meanX) * (y[i] - meanY)))
  const spread = Math.sqrt(computeMean(x.map((v) => (v - meanX) ** 2)) * computeMean(y.map((v) => (v - meanY) ** 2)))
  return spread < 1e-9 ? 0 : covariance / spread
}

const computeMean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)
const roundToMillis = (value: number) => Math.round(value * 1000) / 1000
