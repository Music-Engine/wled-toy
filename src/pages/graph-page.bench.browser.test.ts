// Editor interaction benchmark behind the numbers in graphs/bench/reports/profile-ui.md.
// Skipped unless VITE_BENCH_UI=1; writes .work/bench/editor.json and .work/bench/editor.md.
// It mounts the real GraphPage and counts what one interaction costs: Vue component updates, JSON passes,
// generateGlsl calls, localStorage writes and wall time.
import { describe, expect, it, vi } from 'vitest'
import { commands } from 'vitest/browser'
import { KeepAlive, createApp, h, nextTick } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import GraphPage from './GraphPage.vue'
import { config } from '@/lib/app/config'
import { graphFileBackendKey } from '@/lib/graph/model/document'
import { parseGraphFile } from '@/lib/graph/model/file'
import { preferences, resetPreferences } from '@/lib/app/preferences'
import { workspace } from '@/lib/app/workspace'
import type { FileBackend } from '@/lib/documents/documents'
import type { GraphNodeData } from '@/lib/graph'

const RUN = import.meta.env.VITE_BENCH_UI === '1'
const DRAG_TICKS = Number(import.meta.env.VITE_BENCH_UI_TICKS ?? 120)
const EDITS = Number(import.meta.env.VITE_BENCH_UI_EDITS ?? 60)
// an interaction that never settles has to report a figure instead of hanging the run
const SETTLE_TIMEOUT_MS = Number(import.meta.env.VITE_BENCH_UI_TIMEOUT ?? 12000)

const glsl = vi.hoisted(() => ({ calls: 0 }))
vi.mock('@/lib/graph', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/graph')>()
  return {
    ...original,
    generateGlsl: (...args: Parameters<typeof original.generateGlsl>) => {
      glsl.calls++
      return original.generateGlsl(...args)
    },
  }
})

const FLOW_ID = 'wledtoy-graph'

const files = {
  ...import.meta.glob('/graphs/*.wledgraph', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('/graphs/bench/*.wledgraph', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>
const graphText = Object.fromEntries(Object.entries(files).map(([path, text]) => [path.split('/').pop()!.replace('.wledgraph', ''), text]))

const only = import.meta.env.VITE_BENCH_UI_ONLY as string | undefined
const CASES = ['spectral-aurora', 'bench-kitchen-sink', 'bench-control-chain', 'bench-wide']
  .filter((name) => !only || only.split(',').includes(name))

const counters = {
  updates: 0,
  stringify: 0,
  stringifyChars: 0,
  stringifyPretty: 0,
  stringifyMs: 0,
  parse: 0,
  parseChars: 0,
  parseMs: 0,
  setItem: 0,
  setItemChars: 0,
  recursive: 0,
}
type Counters = typeof counters
const reset = () => {
  for (const key of Object.keys(counters) as (keyof Counters)[]) counters[key] = 0
  glsl.calls = 0
}

const nativeStringify = JSON.stringify
const nativeParse = JSON.parse
const nativeSetItem = Storage.prototype.setItem

function instrument() {
  JSON.stringify = function stringify(this: unknown, ...args: Parameters<typeof nativeStringify>) {
    const at = performance.now()
    const text = nativeStringify.apply(this, args) as string | undefined
    counters.stringifyMs += performance.now() - at
    counters.stringify++
    counters.stringifyChars += text?.length ?? 0
    if (args[2] !== undefined) counters.stringifyPretty++
    return text as string
  } as typeof JSON.stringify
  JSON.parse = function parse(this: unknown, ...args: Parameters<typeof nativeParse>) {
    const at = performance.now()
    const value = nativeParse.apply(this, args)
    counters.parseMs += performance.now() - at
    counters.parse++
    counters.parseChars += typeof args[0] === 'string' ? args[0].length : 0
    return value
  } as typeof JSON.parse
  Storage.prototype.setItem = function setItem(this: Storage, key: string, value: string) {
    counters.setItem++
    counters.setItemChars += value.length
    return nativeSetItem.call(this, key, value)
  }
}

// Vue aborts a self-retriggering flush by throwing out of a promise job; that abort is a result here, not a crash
const isRecursive = (reason: unknown) => String((reason as Error | undefined)?.message ?? reason).includes('Maximum recursive updates')
const onRejection = (event: PromiseRejectionEvent) => {
  if (!isRecursive(event.reason)) return
  counters.recursive++
  event.preventDefault()
}

function restore() {
  JSON.stringify = nativeStringify
  JSON.parse = nativeParse
  Storage.prototype.setItem = nativeSetItem
}

const backend: FileBackend = {
  open: async () => null,
  save: async () => undefined,
  saveAs: async () => null,
}

const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0))
const flush = async () => {
  await nextTick()
  await macrotask()
}

/** Waits until nothing re-renders any more, and reports the time up to the last change rather than the quiet window. */
async function settle(timeout = SETTLE_TIMEOUT_MS) {
  const start = performance.now()
  let seen = counters.updates
  let lastChange = start
  let quiet = 0
  while (performance.now() - start < timeout) {
    await macrotask()
    if (counters.updates === seen) {
      if (++quiet >= 5) break
    } else {
      quiet = 0
      seen = counters.updates
      lastChange = performance.now()
    }
  }
  return { ms: lastChange - start, settled: quiet >= 5 }
}

interface Measurement {
  ms: number
  /** `ms` with the JSON passes taken out, so an interaction can be judged before the snapshot work is fixed. */
  msNoJson: number
  updates: number
  stringify: number
  stringifyPretty: number
  stringifyKchars: number
  parse: number
  parseKchars: number
  setItem: number
  setItemKchars: number
  generateGlsl: number
  recursive: number
  settled?: boolean
}

const per = (n: number, settled?: boolean, ms?: number): Measurement => ({
  ms: Number(((ms ?? 0) / n).toFixed(2)),
  msNoJson: Number((Math.max(0, (ms ?? 0) - counters.stringifyMs - counters.parseMs) / n).toFixed(2)),
  updates: Number((counters.updates / n).toFixed(1)),
  stringify: Number((counters.stringify / n).toFixed(1)),
  stringifyPretty: Number((counters.stringifyPretty / n).toFixed(2)),
  stringifyKchars: Number((counters.stringifyChars / n / 1000).toFixed(1)),
  parse: Number((counters.parse / n).toFixed(1)),
  parseKchars: Number((counters.parseChars / n / 1000).toFixed(1)),
  setItem: Number((counters.setItem / n).toFixed(2)),
  setItemKchars: Number((counters.setItemChars / n / 1000).toFixed(1)),
  generateGlsl: Number((glsl.calls / n).toFixed(2)),
  recursive: counters.recursive,
  ...(settled === undefined ? {} : { settled: settled && counters.recursive === 0 }),
})

interface CaseResult extends Record<string, Measurement | number> {
  nodes: number
  edges: number
}

async function measure(name: string): Promise<CaseResult> {
  const doc = parseGraphFile(graphText[name])
  config.graph = doc
  workspace.mode = 'graph'
  preferences.autosave = false

  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({
    render: () => h('div', { style: 'width: 1200px; height: 800px' }, h(KeepAlive, null, [h(GraphPage)])),
  })
  app.provide(graphFileBackendKey, backend)
  app.config.warnHandler = () => undefined
  app.mixin({ updated() { counters.updates++ } })

  reset()
  const mountStart = performance.now()
  app.mount(root)
  const mounted = await settle()
  const result: Record<string, Measurement> = {
    mount: { ...per(1, mounted.settled, mounted.ms), ms: Number((performance.now() - mountStart).toFixed(1)) },
  }
  expect(document.querySelectorAll('.vue-flow__node').length).toBe(doc.nodes.length)

  const flow = useVueFlow(FLOW_ID)

  // drag: one mousedown, DRAG_TICKS mousemove, one mouseup, timing whole move-plus-flush intervals
  const handle = document.querySelector<HTMLElement>('.vue-flow__node')!
  const at = handle.getBoundingClientRect()
  // d3-drag, which Vue Flow uses, reads event.view.document, so the events need a view
  const point = (i: number) => ({ clientX: at.left + 5 + i, clientY: at.top + 5 + i, bubbles: true, button: 0, view: window })
  handle.dispatchEvent(new MouseEvent('mousedown', point(0)))
  await flush()
  reset()
  let dragMs = 0
  for (let i = 1; i <= DRAG_TICKS; i++) {
    const t0 = performance.now()
    window.dispatchEvent(new MouseEvent('mousemove', point(i)))
    await flush()
    dragMs += performance.now() - t0
  }
  result.drag = per(DRAG_TICKS, undefined, dragMs)
  window.dispatchEvent(new MouseEvent('mouseup', point(DRAG_TICKS)))
  await settle()

  // value edit: the same write a knob, a scene fade and MIDI all go through
  const edited = flow.getNodes.value.find((node) => Object.values((node.data as GraphNodeData).values).some((v) => typeof v === 'number'))!
  const field = Object.entries((edited.data as GraphNodeData).values).find(([, v]) => typeof v === 'number')![0]
  const base = (edited.data as GraphNodeData).values[field] as number
  reset()
  let editMs = 0
  for (let i = 1; i <= EDITS; i++) {
    const t0 = performance.now()
    flow.updateNodeData<GraphNodeData>(edited.id, { values: { ...(edited.data as GraphNodeData).values, [field]: base + i * 0.01 } })
    await flush()
    editMs += performance.now() - t0
    // a scene fade writes one change per frame; the pause lets the 16 ms regenerate timer run between changes
    await new Promise((resolve) => setTimeout(resolve, 16))
  }
  result.valueEdit = per(EDITS, undefined, editMs)
  await settle()

  // one existing link is pulled out and put back, so the added link is known to be valid
  const edge = { ...flow.edges.value[0] }
  reset()
  const removeStart = performance.now()
  flow.removeEdges([edge.id])
  const removed = await settle()
  result.edgeRemove = per(1, removed.settled, removed.settled ? removed.ms : performance.now() - removeStart)

  reset()
  const addStart = performance.now()
  flow.addEdges([edge])
  const added = await settle()
  result.edgeAdd = per(1, added.settled, added.settled ? added.ms : performance.now() - addStart)

  app.unmount()
  await macrotask()
  root.remove()
  config.graph = null
  resetPreferences()
  workspace.mode = 'shader'
  return { nodes: doc.nodes.length, edges: doc.edges.length, ...result }
}

const COLUMNS: (keyof Measurement)[] = ['ms', 'msNoJson', 'updates', 'stringify', 'parse', 'stringifyKchars', 'setItem', 'generateGlsl', 'recursive', 'settled']

function table(results: Record<string, CaseResult>) {
  const lines = ['# Editor benchmark', '', `Generated ${new Date().toISOString()}. ${DRAG_TICKS} drag ticks, ${EDITS} value edits.`, '']
  for (const interaction of ['mount', 'drag', 'valueEdit', 'edgeRemove', 'edgeAdd']) {
    lines.push(`## ${interaction}`, '', `| graph | nodes | ${COLUMNS.join(' | ')} |`, `| --- | --- | ${COLUMNS.map(() => '---').join(' | ')} |`)
    for (const [name, result] of Object.entries(results)) {
      const row = result[interaction] as Measurement
      lines.push(`| ${name} | ${result.nodes} | ${COLUMNS.map((c) => row[c] ?? '').join(' | ')} |`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

describe.runIf(RUN)('editor benchmark', () => {
  const results: Record<string, CaseResult> = {}

  for (const name of CASES) {
    it(name, { timeout: 600000 }, async () => {
      instrument()
      window.addEventListener('unhandledrejection', onRejection)
      try {
        results[name] = await measure(name)
      } finally {
        window.removeEventListener('unhandledrejection', onRejection)
        restore()
      }
      // eslint-disable-next-line no-console
      console.log(name, nativeStringify(results[name], null, 1))
      await commands.writeFile('.work/bench/editor.json', nativeStringify(results, null, 1))
      await commands.writeFile('.work/bench/editor.md', table(results))
    })
  }
})
