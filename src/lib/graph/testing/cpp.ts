import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeAudioFeatures } from '@/lib/audio/features'
import { MAX_SPECTRUM_BINS } from '@/lib/audio/textures'
import { createUsermodCompiler } from '@/lib/graph/compile/compilers'
import type { NodeGraph } from '@/lib/graph/model/doc'
import { AUDIO_EXTRA_SLOTS } from '@/lib/shader/prelude'
import { FPS, SAMPLE_RATE } from './offline'
import { USERMOD_MAIN } from './usermod-main'

/** Syntax-checks `code` against cpp/ w/ CI's flags, as the cpp job does; node tests only */
export function buildCpp(code: string): { status: number | null; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'wledtoy-cpp-'))
  try {
    const built = compileUnit(code, join(dir, 'unit'), ['-fsyntax-only'])
    return { status: built.status, output: built.stderr }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Graph via the usermod target, rendered as runUsermod does; throws the compile's issues when it withholds the unit */
export function runOffline(doc: NodeGraph, options: UsermodOptions): number[][][] {
  const { program, issues } = createUsermodCompiler(options.leds).compile(doc)
  if (!program) throw new Error(issues.map((issue) => issue.message).join('; '))
  return runUsermod(program.code, options)
}

export interface UsermodOptions {
  leds: number
  frames: number
  /** Header audio arrays per frame; a frame w/o an entry is silent */
  feed?: AudioFrame[]
}

export interface AudioFrame {
  /** Per slot from 0: 16 levels of iAudioBands, then each iAudioBandsExtra, 0 to 1; missing row = silent */
  bands?: ArrayLike<number>[]
  /** In AUDIO_FEATURES order; absent = silence at 120 BPM */
  features?: ArrayLike<number>
  /** Per slot from 0: iAudioSpectra row, bins as levels 0 to 1 */
  spectrum?: ArrayLike<number>[]
  /** Samples since prev frame, -1 to 1, pushed onto iAudioWave */
  samples?: ArrayLike<number>
}

/**
 * Any unit defining `ledCount` and `renderFrame`, frame i at i / FPS, iTimeDelta 1 / FPS so global state steps as in
 * the engine: per frame, [r, g, b] per LED, 0 to 255
 */
export function runUsermod(code: string, { leds, frames, feed = [] }: UsermodOptions): number[][][] {
  const input = Array.from({ length: frames }, (_, frame) => toFeedLine(frame, feed[frame] ?? {}))
  const ran = spawnSync(buildOfflineBinary([code, ...USERMOD_MAIN].join('\n')), { input: input.map((line) => line.join(' ')).join('\n'), encoding: 'utf8' })
  if (ran.status !== 0) throw new Error(`The offline unit exited with ${ran.status}: ${ran.stderr}`)
  return ran.stdout
    .split('\n')
    .slice(0, -1)
    .map((line) => {
      const bytes = line.trim().split(' ').map(Number)
      return Array.from({ length: leds }, (_, i) => bytes.slice(i * 3, i * 3 + 3))
    })
}

const SILENT = computeAudioFeatures(null, SAMPLE_RATE)

/** USERMOD_MAIN stdin line: time, sample rate, 16 bands per slot, features, bin count and bins per slot, sample count and samples */
function toFeedLine(frame: number, { bands = [], features = SILENT, spectrum = [], samples = [] }: AudioFrame): number[] {
  const slots = Array.from({ length: 1 + AUDIO_EXTRA_SLOTS }, (_, slot) => Array.from(bands[slot] ?? new Array(16).fill(0)))
  if (slots.some((row) => row.length !== 16)) throw new Error('Each slot of a feed frame holds 16 bands')
  const spectra = Array.from({ length: 1 + AUDIO_EXTRA_SLOTS }, (_, slot) => Array.from(spectrum[slot] ?? []))
  if (spectra.some((row) => row.length > MAX_SPECTRUM_BINS)) throw new Error(`A slot of a feed frame's spectrum holds at most ${MAX_SPECTRUM_BINS} bins`)
  return [
    frame / FPS,
    SAMPLE_RATE,
    ...slots.flat(),
    ...Array.from(features),
    ...spectra.flatMap((row) => [row.length, ...row]),
    samples.length,
    ...Array.from(samples),
  ]
}

// One binary per unit text per process, so a graph rendered many times builds once
const binaries = new Map<string, string>()
let cacheDir: string | undefined

function buildOfflineBinary(unit: string): string {
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
  return spawnSync(cppCompiler, [...readCiFlags(), '-I', 'cpp', ...flags, `${binary}.cpp`], { encoding: 'utf8' })
}

/** First of g++ and c++ on PATH */
export const cppCompiler = ['g++', 'c++'].find((command) => !spawnSync(command, ['--version']).error)

// Read from the workflow, so a flag CI adds is one tests build with
const readCiFlags = () => /^\s+CXXFLAGS: (.+)$/m.exec(readFileSync('.github/workflows/ci.yml', 'utf8'))![1].split(' ')
