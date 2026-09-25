import { afterEach, expect, it } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'
import PerformancePanel from './PerformancePanel.vue'
import type { BridgeStats, HistoryKey } from '@/lib/bridge/bridge-client'

let unmount: (() => void) | undefined
afterEach(() => unmount?.())

const healthy = (): BridgeStats => ({
  renderFps: 60, sendFps: 29.8, framesSent: 18204, framesDropped: 0, kbps: 212,
  ledRenderMs: 0.42, rttMs: 3.1, udpMs: 0.08, deviceMs: 84, deviceFps: 30,
  status: 'connected', device: null,
})

function mount(stats: BridgeStats, streaming = true) {
  const history = Object.fromEntries(['renderFps', 'sendFps', 'kbps', 'ledRenderMs', 'rttMs', 'udpMs', 'deviceMs'].map((key) => [key, [1, 3, 2]])) as Record<HistoryKey, number[]>
  const props = reactive({ stats, history, targetFps: 30, streaming })
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(PerformancePanel, props) })
  app.mount(root)
  unmount = () => { app.unmount(); root.remove() }
  const value = (metric: string) => root.querySelector<HTMLElement>(`[data-metric="${metric}"] .metric-value`)!
  return { root, props, value }
}

it('is one table of rows in three groups, with frames sent and dropped as rows and no cards, badges or icons', () => {
  const { root } = mount(healthy())
  const groups = [...root.querySelectorAll('table')].map((table) => [
    table.querySelector('th')!.textContent,
    [...table.querySelectorAll('tbody tr')].map((row) => row.getAttribute('data-metric')),
  ])
  expect(groups).toEqual([
    ['Render', ['renderFps', 'ledRenderMs']],
    ['Link', ['sendFps', 'kbps', 'rttMs', 'udpMs']],
    ['Device', ['deviceMs', 'deviceFps', 'framesSent', 'framesDropped']],
  ])
  expect([...root.querySelectorAll('tr')].every((row) => row.classList.contains('h-(--app-row-dense-h)'))).toBe(true)
  expect(root.querySelector('ubadge, uicon, [class*="i-lucide"], [class*="rounded"], [class*="uppercase"]')).toBeNull()
  // a sparkline for every metric with a history, and only for those
  expect([...root.querySelectorAll('tr:has(svg)')].map((row) => row.getAttribute('data-metric'))).toEqual(['renderFps', 'ledRenderMs', 'sendFps', 'kbps', 'rttMs', 'udpMs', 'deviceMs'])
  expect(root.querySelector('[data-metric="sendFps"]')!.textContent).toContain('29.8')
  expect(root.querySelector('[data-metric="sendFps"]')!.textContent).toContain('/ 30 fps')
  expect(root.querySelector('[data-metric="framesSent"] .metric-value')!.textContent).toBe((18204).toLocaleString())
})

it('healthy values carry no status color', () => {
  const { root } = mount(healthy())
  expect([...root.querySelectorAll('.metric-value')].map((el) => el.getAttribute('data-status'))).toEqual(Array(10).fill('ok'))
  expect(root.querySelector('.text-warning, .text-error')).toBeNull()
})

it('a crossed threshold colors the value text and nothing else in the row', async () => {
  const { root, props, value } = mount(healthy())
  props.stats.rttMs = 20
  await nextTick()
  expect(value('rttMs').classList.contains('text-warning')).toBe(true)
  props.stats.rttMs = 40
  await nextTick()
  expect(value('rttMs').classList.contains('text-error')).toBe(true)
  expect([...root.querySelectorAll('.text-warning, .text-error')]).toEqual([value('rttMs')])

  props.stats.rttMs = 3
  props.stats.framesDropped = 2
  props.stats.renderFps = 30
  props.stats.ledRenderMs = (1000 / 30) * 0.7
  await nextTick()
  expect(['rttMs', 'framesDropped', 'renderFps', 'ledRenderMs'].map((metric) => value(metric).getAttribute('data-status'))).toEqual(['ok', 'warning', 'warning', 'error'])
})

it('a slow send rate is a warning only while streaming, and a value that is not known yet shows a dash', async () => {
  const { props, value } = mount({ ...healthy(), sendFps: 12, rttMs: null }, false)
  expect(value('sendFps').getAttribute('data-status')).toBe('ok')
  expect(value('rttMs').textContent).toBe('-')
  expect(value('rttMs').getAttribute('data-status')).toBe('ok')
  props.streaming = true
  await nextTick()
  expect(value('sendFps').getAttribute('data-status')).toBe('warning')
})
