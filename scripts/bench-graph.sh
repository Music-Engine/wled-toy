#!/bin/sh
# Times graphs/*.wledgraph and graphs/bench/*.wledgraph and writes .work/bench/<name>.json plus .work/bench/summary.md.
# Usage: scripts/bench-graph.sh [name]   (name is the file name without .wledgraph; omit it for every graph)
cd "$(dirname "$0")/.." || exit 1
VITE_GRAPH_BENCH=1 VITE_GRAPH_ONLY="$1" exec npx vitest run --project browser-gpu bench-graphs.browser.test.ts
