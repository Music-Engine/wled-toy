// Builds generated C++ the way the cpp job in CI does, on whichever of g++ or c++ this machine has. Node tests only;
// browser tests reach runOffline through the command vitest.config.ts registers.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { audioFeatures } from '@/lib/audio/features'
import { buildProgram, offlineUnit } from '@/lib/graph/compile/compile'
import type { NodeGraph } from '@/lib/graph/model/doc'
import { AUDIO_EXTRA_SLOTS } from '@/lib/shader/prelude'
import { FPS, SAMPLE_RATE } from './offline'

/** Compiles `code` against cpp/ with CI's flags; with `run`, runs the binary and returns what it printed instead. */
export function buildCpp(code: string, { run }: { run: boolean }): CppRun {
  const dir = mkdtempSync(join(tmpdir(), 'wledtoy-cpp-'))
  try {
    const binary = join(dir, 'unit')
    const built = compileUnit(code, binary, run ? ['-o', binary] : ['-fsyntax-only'])
    if (built.status !== 0 || !run) return { status: built.status, output: built.stderr }
    const ran = spawnSync(binary, { encoding: 'utf8' })
    return { status: ran.status, output: ran.stdout }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

interface CppRun {
  status: number | null
  output: string
}

export interface OfflineOptions {
  leds: number
  frames: number
  /** iAudioBands for each frame, 16 levels from 0 to 1; a frame without a row is silent. */
  feed?: number[][]
}

/** Renders a pixel-only graph through its C++ unit, frame i at time i / FPS: per frame, one [r, g, b] per LED, 0 to 255. */
export function runOffline(doc: NodeGraph, { leds, frames, feed = [] }: OfflineOptions): number[][][] {
  if (feed.some((bands) => bands.length !== 16)) throw new Error('Each feed row holds the 16 bands of iAudioBands')
  const input = Array.from({ length: frames }, (_, frame) => [frame / FPS, ...(feed[frame] ?? new Array(16).fill(0))])
  return renderUnit(offlineUnit(buildProgram(doc, {}), { leds }), input, leds)
}

export interface UsermodOptions {
  leds: number
  frames: number
  /** What the host fills the header's audio arrays with, per frame; a frame without an entry is silent. */
  feed?: AudioFrame[]
}

export interface AudioFrame {
  /** Per slot from 0, the 16 levels of iAudioBands, then of each iAudioBandsExtra, 0 to 1; a slot without a row is silent. */
  bands?: ArrayLike<number>[]
  /** iAudioFeatures, in the order of AUDIO_FEATURES; silence at 120 BPM when absent. */
  features?: ArrayLike<number>
  /** iAudioSpectrum, 512 levels from 0 to 1; silent when absent. */
  spectrum?: ArrayLike<number>
  /** The samples since the previous frame, -1 to 1, pushed onto iAudioWave. */
  samples?: ArrayLike<number>
}

/**
 * Renders a usermod target's unit, or any unit that defines `ledCount` and `renderFrame` as one does, with iTimeDelta at
 * 1 / FPS, so a frame pass steps its global state as the engine would. Takes the code, since only compile/ reaches the
 * new compiler until cut-over.
 */
export function runUsermod(code: string, { leds, frames, feed = [] }: UsermodOptions): number[][][] {
  const input = Array.from({ length: frames }, (_, frame) => feedLine(frame, feed[frame] ?? {}))
  return renderUnit([code, ...USERMOD_MAIN].join('\n'), input, leds)
}

function renderUnit(unit: string, input: number[][], leds: number): number[][][] {
  const ran = spawnSync(offlineBinary(unit), { input: input.map((line) => line.join(' ')).join('\n'), encoding: 'utf8' })
  if (ran.status !== 0) throw new Error(`The offline unit exited with ${ran.status}: ${ran.stderr}`)
  return ran.stdout.split('\n').slice(0, -1).map((line) => {
    const bytes = line.trim().split(' ').map(Number)
    return Array.from({ length: leds }, (_, i) => bytes.slice(i * 3, i * 3 + 3))
  })
}

const SILENT = audioFeatures(null, SAMPLE_RATE)

/** One stdin line of USERMOD_MAIN: the time, the sample rate, 16 bands per slot, the features, the spectrum, then the sample count and the samples. */
function feedLine(frame: number, { bands = [], features = SILENT, spectrum = new Array(512).fill(0), samples = [] }: AudioFrame): number[] {
  const slots = Array.from({ length: 1 + AUDIO_EXTRA_SLOTS }, (_, slot) => Array.from(bands[slot] ?? new Array(16).fill(0)))
  if (slots.some((row) => row.length !== 16)) throw new Error('Each slot of a feed frame holds 16 bands')
  if (spectrum.length !== 512) throw new Error('A feed frame\'s spectrum holds 512 levels')
  return [frame / FPS, SAMPLE_RATE, ...slots.flat(), ...Array.from(features), ...Array.from(spectrum), samples.length, ...Array.from(samples)]
}

// the host's side of a usermod: each line fills the header's audio arrays, pushes one history row per slot and the new
// samples, renders the frame at that time with iTimeDelta at 1 / FPS and prints its LED bytes
const USERMOD_MAIN = [
  '#include <cstdio>',
  '',
  'namespace host {',
  'bool read(float* values, int count) {',
  '  for (int i = 0; i < count; i++) if (std::scanf("%f", &values[i]) != 1) return false;',
  '  return true;',
  '}',
  'void pushRow(float (*rows)[wledtoy::audioBands], float& head, const float* bands) {',
  '  head = float((int(head) + 1) % wledtoy::audioHistoryRows);',
  '  for (int i = 0; i < wledtoy::audioBands; i++) rows[int(head)][i] = bands[i];',
  '}',
  '}',
  '',
  'int main() {',
  '  using namespace wledtoy;',
  `  iTimeDelta = 1.0f / ${FPS}.0f;`,
  '  static vec3 colors[ledCount];',
  '  float time, sampleRate;',
  '  int samples;',
  '  for (int frame = 0; std::scanf("%f %f", &time, &sampleRate) == 2; frame++) {',
  '    if (!host::read(iAudioBands, audioBands)) return 1;',
  '    for (float* bands : iAudioBandsExtra) if (!host::read(bands, audioBands)) return 1;',
  '    for (vec4& features : iAudioFeatures) if (!host::read(features.c, 4)) return 1;',
  '    if (!host::read(iAudioSpectrum, audioSpectrumBins)) return 1;',
  '    if (std::scanf("%d", &samples) != 1) return 1;',
  '    for (int i = 0; i < samples; i++, iAudioHeads.y = float((int(iAudioHeads.y) + 1) % audioWaveSamples)) {',
  '      if (!host::read(&iAudioWave[int(iAudioHeads.y)], 1)) return 1;',
  '    }',
  '    host::pushRow(iAudioHistory, iAudioHeads.x, iAudioBands);',
  '    for (int slot = 0; slot < audioExtraSlots; slot++) host::pushRow(iAudioHistoryExtra[slot], iAudioHistoryHeadExtra[slot], iAudioBandsExtra[slot]);',
  '    iAudioHeads.z = sampleRate;',
  '    renderFrame(time, frame, colors);',
  '    for (const vec3& c : colors) std::printf("%d %d %d ", int(c.x * 255.0f + 0.5f), int(c.y * 255.0f + 0.5f), int(c.z * 255.0f + 0.5f));',
  '    std::printf("\\n");',
  '  }',
  '}',
  '',
]

// one binary per unit text for the life of the process, so a file that renders a graph many times builds it once
const binaries = new Map<string, string>()
let cacheDir: string | undefined

function offlineBinary(unit: string): string {
  const cached = binaries.get(unit)
  if (cached) return cached
  if (!cacheDir) {
    const dir = mkdtempSync(join(tmpdir(), 'wledtoy-offline-'))
    process.once('exit', () => rmSync(dir, { recursive: true, force: true }))
    cacheDir = dir
  }
  const binary = join(cacheDir, `unit${binaries.size}`)
  const built = compileUnit(unit, binary, ['-o', binary])
  if (built.status !== 0) throw new Error(`The offline unit did not build:\n${built.stderr}`)
  binaries.set(unit, binary)
  return binary
}

function compileUnit(code: string, binary: string, flags: string[]) {
  if (!cppCompiler) throw new Error('Building C++ needs g++ or c++ on PATH')
  writeFileSync(`${binary}.cpp`, code)
  return spawnSync(cppCompiler, [...ciFlags(), '-I', 'cpp', ...flags, `${binary}.cpp`], { encoding: 'utf8' })
}

/** The first of g++ and c++ on PATH; undefined when neither is. */
export const cppCompiler = ['g++', 'c++'].find((command) => !spawnSync(command, ['--version']).error)

// read from the workflow rather than copied, so a flag CI adds is one the tests build with too
const ciFlags = () => /^\s+CXXFLAGS: (.+)$/m.exec(readFileSync('.github/workflows/ci.yml', 'utf8'))![1].split(' ')
