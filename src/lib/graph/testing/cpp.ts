// Builds generated C++ the way the cpp job in CI does, on whichever of g++ or c++ this machine has. Node tests only;
// browser tests reach runOffline through the command vitest.config.ts registers.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildProgram, offlineUnit } from '@/lib/graph/compile/compile'
import type { NodeGraph } from '@/lib/graph/model/doc'
import { FPS } from './offline'

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
export function runOffline(doc: NodeGraph, options: OfflineOptions): number[][][] {
  return renderUnit(offlineUnit(buildProgram(doc, {}), { leds: options.leds }), options)
}

/**
 * Renders a usermod target's unit as runOffline renders the old one, with iTimeDelta at 1 / FPS, so a frame pass steps
 * its global state as the engine would. Takes the code, since only compile/ reaches the new compiler until cut-over.
 */
export function runUsermod(code: string, options: OfflineOptions): number[][][] {
  return renderUnit([code, ...USERMOD_MAIN].join('\n'), options)
}

// the host's side of a usermod unit: what runOffline's unit reads per stdin line, and the frame time the host fills
const USERMOD_MAIN = [
  '#include <cstdio>',
  '',
  'int main() {',
  '  static wledtoy::vec3 colors[wledtoy::ledCount];',
  `  wledtoy::iTimeDelta = 1.0f / ${FPS}.0f;`,
  '  float time;',
  '  for (int frame = 0; std::scanf("%f", &time) == 1; frame++) {',
  '    for (float& band : wledtoy::iAudioBands) if (std::scanf("%f", &band) != 1) return 1;',
  '    wledtoy::renderFrame(time, frame, colors);',
  '    for (const wledtoy::vec3& c : colors) std::printf("%d %d %d ", int(c.x * 255.0f + 0.5f), int(c.y * 255.0f + 0.5f), int(c.z * 255.0f + 0.5f));',
  '    std::printf("\\n");',
  '  }',
  '}',
  '',
]

function renderUnit(unit: string, { leds, frames, feed = [] }: OfflineOptions): number[][][] {
  if (feed.some((bands) => bands.length !== 16)) throw new Error('Each feed row holds the 16 bands of iAudioBands')
  const binary = offlineBinary(unit)
  const input = Array.from({ length: frames }, (_, frame) => [frame / FPS, ...(feed[frame] ?? new Array(16).fill(0))].join(' ')).join('\n')
  const ran = spawnSync(binary, { input, encoding: 'utf8' })
  if (ran.status !== 0) throw new Error(`The offline unit exited with ${ran.status}: ${ran.stderr}`)
  return ran.stdout.split('\n').slice(0, -1).map((line) => {
    const bytes = line.trim().split(' ').map(Number)
    return Array.from({ length: leds }, (_, i) => bytes.slice(i * 3, i * 3 + 3))
  })
}

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
