# AGENTS.md

WLEDToy: Vue 3 + Vite frontend, Tauri v2 shell (`src-tauri/`, Rust), node graphs and GLSL rendered per frame and streamed to WLED over UDP.

## Layout

- `src/lib/graph`: `define/` (node API: types, socket types, `defineNode`, inference, shape, context, value), `compile/` (`compile.ts` entry, `front-end/` passes that build the plain-data `Program`, backends `glsl/`, `js/`, `cpp/`, the gate tests and `__snapshots__`), `model/` (doc, file, lint), `nodes/` (one folder per category listed in `nodes/index.ts`; shared node helpers in `nodes/shared/`, shared GLSL chunks in `nodes/glsl/`, the shader-function catalog in `catalog.ts`), `registry.ts`, `menu/`, `testing/`. Two barrels: a node file imports only `authoring.ts`; the app imports `index.ts`.
- `cpp/`: the C++ compatibility header (`wledtoy.h` includes `vecmath.h`, `runtime.h`, `prelude.h`) and the negative fixture. `scripts/gen-cpp-unit.ts` writes the gitignored `cpp/generated/` units; the `cpp` CI job compiles every pixel body through the header and runs the op parity binary.
- `src/lib/engine`: frame loop, fades, MIDI; `render/` (renderer, its GL targets and inputs), `media/` (image library, stored song and image), `output/` (LED post-process, layout). `src/lib/audio`: service, settings, capture, analysis slots, the worklet and `dsp/`.
- `src/lib/app`: logs, platform, workspace, version; `commands/` (registry, accelerators, the app's commands; `@/lib/app/commands` registers them), `files/` (pick, download, drop, clipboard), `settings/` (config, devices, preferences, storage). `src/lib/documents`: the store, history; `sessions/`, `edits/` (links, paste), `files/` (file backends, Tauri file I/O). `src/lib/bridge`, `src/lib/native`: the edges to the UDP bridge and the desktop shell.
- `src/lib/shader`: the GLSL prelude, the function catalog, examples, the editor language (highlight, completions, diagnostics), shader export. `src/lib/util`: small pure helpers (files, format, ids, json, math).
- `src/features/<feature>`: one folder per feature (audio, commands, documents, graph-editor, logs, node-ui, output, parameters, performance, reference, settings, shader-editor, shell), each with its components, composables and browser tests. Node UI lives in `src/features/node-ui`, each part with its own CSS; `src/assets` holds only `main.css`.
- `src/ui/primitives`: shared presentational components. `src/pages`: the three routed pages and the page-level tests. `src/test`: browser test harnesses.
- `bridge.ts` (root): Node UDP bridge used by the Vite dev server. `src-tauri/src/bridge/`: the Rust one shipped in the app. They must emit identical packets.
- `graphs/`: demo and bench graphs; `graphs/AUTHORING.md` is the reference for writing them.

## Rules

1. Fit in. Reuse what exists before adding: one logger (`src/lib/app/logs.ts`), one config, one command registry (`src/lib/app/commands/registry.ts`), one error type per module. Imports: `./x` for siblings, `@/...` for everything else, never `../`. No new dependency without a concrete cost it removes.
2. Minimal diff. Do what was asked. No drive-by refactors, no speculative options, no dead code. Do not hoist a value into a constant or lookup table unless it is shared, names a magic number, or is real data (palettes, option lists).
3. Fail loudly. No swallowed errors, no silent fallbacks. Invariants are checked where data is created: graph files are linted on load (`src/lib/graph/model/lint.ts`), node values are typed at the socket. Old graph versions are rejected, never migrated.
4. Traceable. One job per function, one owner per piece of state. Domain names (socket, scene, layout, output), not implementation names. Comments say why, never what, and never use em or en dashes.
5. Logic apart from effects. Compile, lint, layout, packet building and DSP are pure and unit-tested. Time, audio, MIDI, files, IPC and the GPU sit at the edges (`engine`, `audio/service`, `documents`, `bridge`, `native`).
6. Evidence. `pnpm typecheck && pnpm test` before claiming done; WebGL and DOM behavior goes in `*.browser.test.ts` (headless Chromium, SwiftShader). Fix the root cause. Never weaken a test to pass it.
7. Safe by default. Scripts under `scripts/` and generators are safe to run twice. Bound every network wait; the bridge drops frames it cannot send.
8. Real-time. The graph doc and shader source are plain serializable data with no UI state. Compile on edit, evaluate per frame from an explicit input snapshot (time, `iControl`, audio textures). The front end places every node per `frame` or per `pixel` and builds a plain-data `Program`; the JS backend runs `frame` bodies once per frame, the GLSL backend runs `pixel` bodies per pixel. The engine owns the clock; stale frames are dropped, never queued. No allocation, logging or IPC on the frame path. Features unused by a shader must cost that shader nothing.
9. Graph module. Within `@/lib/graph`, files under `nodes/` import only `authoring.ts`, their own folder, `nodes/glsl/` and `nodes/shared/` (modules outside the graph, such as `@/lib/shader/catalog`, are fine); nothing outside `compile/` imports a compile stage except the entry points `compile/compile.ts` and `compile/js/frame.ts` (`boundaries.test.ts` enforces both). A story file reads top-down: the exported function first, its private steps in call order, helpers last. `Program` is plain data: no functions, no class instances, bodies resolve through the registry at build version. Rate names are `pixel` and `frame` everywhere (body keys, `stateScope`, placement); never cpu, gpu or control. A helper is named for what it returns (`componentCount`, `linkType`) or decides (`fallsBackToImplicit`); no `xOf`, `xFor`, `xFrom`. Types answer Program questions (`kind`, `check`, `castableFrom`, `dim`); backends answer representation questions through tables keyed by type id; a type never mentions a language. A node owns its metadata, sockets, state slots, `resolve` and its `pixel` and `frame` bodies, and reaches out only through `requires`. Nested conditionals in `define/` and `compile/` fail `rules.test.ts`; a function over 20 lines is reviewed and split or justified, not counted. Files split by job near 200 lines; a folder holds at most about 15 entries.

## Nuance

- Changing packet building in `bridge.ts` requires `node bridge.fixtures.ts`; `bridge.fixtures.test.ts` and `cargo test` fail on stale goldens.
- Every command in `src/lib/app/commands/app-commands.ts` needs a unique accelerator per mode; a unit test enforces it.
- Generated GLSL names keep the `n_<id>` prefix so they never shadow prelude helpers (`bass()`, `beat()`, ...).
- Output node settings in a graph doc override Settings while that graph runs. Intentional.
- `compile/__snapshots__/gate` holds the GLSL and plan JSON of every graph under `graphs/` and every node kind alone, in normal and standalone mode. A PR that changes any `__snapshots__` folder under `src/lib/graph` needs the `snapshot-change` label; a moved snapshot without a reason is a bug.
- A pixel body that needs something only GLSL has calls `ctx.require('glsl')`; those kinds are excluded from the C++ build and `requires.test.ts` pins the list against the node sources.
- `.work/` is regenerable output, never committed. Preview a graph with `scripts/preview-graph.sh <name>`; benchmark with `scripts/bench-graph.sh`.
- The dev server on 5173 may belong to another session; headless checks use vitest's own port.
- Rust: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test` from `src-tauri/`. CI runs them on every PR.
- Commits: `<type>(<scope>): <subject>`, subject line only (no body, no trailers), one logical change each, no AI attribution.
