#!/bin/sh
# Times editor interactions on GraphPage and writes .work/bench/editor.json plus .work/bench/editor.md.
# Usage: scripts/bench-editor.sh [name]   (name is a graph file name without .wledgraph; omit it for all four sizes)
cd "$(dirname "$0")/.." || exit 1
VITE_BENCH_UI=1 VITE_BENCH_UI_ONLY="$1" exec npx vitest run --project browser graph-page.bench.browser.test.ts
