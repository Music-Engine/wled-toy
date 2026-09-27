// Builds generated C++ the way the cpp job in CI does, on whichever of g++ or c++ this machine has. Node tests only.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Compiles `code` against cpp/ with CI's flags; with `run`, runs the binary and returns what it printed instead. */
export function buildCpp(code: string, { run }: { run: boolean }): CppRun {
  const dir = mkdtempSync(join(tmpdir(), 'wledtoy-cpp-'))
  try {
    writeFileSync(join(dir, 'unit.cpp'), code)
    const binary = join(dir, 'unit')
    const flags = run ? ['-o', binary] : ['-fsyntax-only']
    const built = spawnSync(cppCompiler!, [...ciFlags(), '-I', 'cpp', ...flags, join(dir, 'unit.cpp')], { encoding: 'utf8' })
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

/** The first of g++ and c++ on PATH; undefined when neither is. */
export const cppCompiler = ['g++', 'c++'].find((command) => !spawnSync(command, ['--version']).error)

// read from the workflow rather than copied, so a flag CI adds is one the tests build with too
const ciFlags = () => /^\s+CXXFLAGS: (.+)$/m.exec(readFileSync('.github/workflows/ci.yml', 'utf8'))![1].split(' ')
