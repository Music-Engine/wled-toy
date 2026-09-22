# AGENTS.md

WLEDToy: Vue 3 + Vite frontend, Tauri v2 shell (`src-tauri/`, Rust), node graphs and GLSL rendered per frame and streamed to WLED over UDP.

## Layout

- `src/lib/graph`: `define/` (node API, sockets, types), `compile/` (graph to GLSL and control plan), `model/` (doc, file, lint), `nodes/` (one folder per category, listed in `catalog.ts`). `index.ts` is the public barrel.
- `src/lib/engine`: frame loop, renderer, output, layout, MIDI. `src/lib/audio`: analysis and the worklet.
- `src/lib/app`: commands, preferences, workspace, devices, logs. `src/lib/documents`: sessions, history, Tauri file I/O. `src/lib/bridge`, `src/lib/native`: the edges to the UDP bridge and the desktop shell.
- `src/components/{shell,panels,editor,graph}`, `src/pages`. Node UI lives in `src/assets/node-ui.css` and `src/components/graph/ui/`.
- `bridge.ts` (root): Node UDP bridge used by the Vite dev server. `src-tauri/src/bridge/`: the Rust one shipped in the app. They must emit identical packets.
- `graphs/`: demo and bench graphs; `graphs/AUTHORING.md` is the reference for writing them.

## Rules

1. Fit in. Reuse what exists before adding: one logger (`src/lib/app/logs.ts`), one config, one command registry (`src/lib/app/commands.ts`), one error type per module. Imports: `./x` for siblings, `@/...` for everything else, never `../`. No new dependency without a concrete cost it removes.
2. Minimal diff. Do what was asked. No drive-by refactors, no speculative options, no dead code. Do not hoist a value into a constant or lookup table unless it is shared, names a magic number, or is real data (palettes, option lists).
3. Fail loudly. No swallowed errors, no silent fallbacks. Invariants are checked where data is created: graph files are linted on load (`src/lib/graph/model/lint.ts`), node values are typed at the socket. Old graph versions are rejected, never migrated.
4. Traceable. One job per function, one owner per piece of state. Domain names (socket, scene, layout, output), not implementation names. Comments say why, never what, and never use em or en dashes.
5. Logic apart from effects. Compile, lint, layout, packet building and DSP are pure and unit-tested. Time, audio, MIDI, files, IPC and the GPU sit at the edges (`engine`, `audio/service`, `documents`, `bridge`, `native`).
6. Evidence. `pnpm typecheck && pnpm test` before claiming done; WebGL and DOM behavior goes in `*.browser.test.ts` (headless Chromium, SwiftShader). Fix the root cause. Never weaken a test to pass it.
7. Safe by default. Scripts under `scripts/` and generators are safe to run twice. Bound every network wait; the bridge drops frames it cannot send.
8. Real-time. The graph doc and shader source are plain serializable data with no UI state. Compile on edit, evaluate per frame from an explicit input snapshot (time, `iControl`, audio textures). CPU does control-rate work (`run`), GPU does per-pixel work (`exec`). The engine owns the clock; stale frames are dropped, never queued. No allocation, logging or IPC on the frame path. Features unused by a shader must cost that shader nothing.

## Nuance

- Changing packet building in `bridge.ts` requires `node bridge.fixtures.ts`; `bridge.fixtures.test.ts` and `cargo test` fail on stale goldens.
- Every command in `commands.ts` needs a unique accelerator per mode; a unit test enforces it.
- Generated GLSL names keep the `n_<id>` prefix so they never shadow prelude helpers (`bass()`, `beat()`, ...).
- Output node settings in a graph doc override Settings while that graph runs. Intentional.
- `.work/` is regenerable output, never committed. Preview a graph with `scripts/preview-graph.sh <name>`; benchmark with `scripts/bench-graph.sh`.
- The dev server on 5173 may belong to another session; headless checks use vitest's own port.
- Rust: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` from `src-tauri/`. CI runs them on every PR.
- Commits: `<type>(<scope>): <subject>`, one logical change each, no AI attribution.
