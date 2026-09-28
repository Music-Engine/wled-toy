import { afterEach, beforeEach, expect, it } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import LogPanel from './LogPanel.vue'
import DockContribution from '@/features/shell/dock/DockContribution.vue'
import DockTabs from '@/features/shell/dock/DockTabs.vue'
import { clearLogs, log, logContext, logFilter, logs } from '@/lib/app/logs'
import { dockHost, resetLayout, selectTab, workspace } from '@/lib/app/workspace'

let unmount: (() => void) | undefined
beforeEach(clearLogs)
afterEach(() => {
  unmount?.()
  resetLayout()
  workspace.mode = 'shader'
  // the filter and context row are shell-shared state now, not local to a mounted instance
  logFilter.value = 'all'
  logContext.value = null
})

// the stylesheet is not loaded here, so the test gives the list the box the dock gives it: a fixed height that scrolls
function mount() {
  const root = document.createElement('div')
  root.innerHTML =
    '<style>.log-panel { display: block; height: 100px; overflow-y: auto; margin: 0; padding: 0 } .log-panel li { display: block; min-height: 20px; line-height: 20px; white-space: pre-wrap }</style>'
  const holder = document.createElement('div')
  root.append(holder)
  document.body.append(root)
  const app = createApp({ render: () => [h(DockContribution, { tab: 'log' }, () => h(LogPanel)), h(DockTabs, { dock: 'bottom' })] })
  // Nuxt UI is not installed here: UContextMenu renders as an unknown element that still shows its default slot
  app.config.warnHandler = () => undefined
  app.mount(holder)
  unmount = () => {
    app.unmount()
    root.remove()
  }
  selectTab('log')
  return { root, list: dockHost('log').querySelector<HTMLElement>('.log-panel')! }
}

const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
const atBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 1
const action = (selector: string) => dockHost('log', 'actions').querySelector<HTMLButtonElement>(selector)!

async function fill(count: number) {
  for (let i = 0; i < count; i++) log(`entry ${i}`)
  await nextTick()
  await frame()
}

it('follows new entries, stops following once the user scrolls up, and follows again from the bottom', async () => {
  const { list } = mount()
  await fill(30)
  expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)
  expect(atBottom(list)).toBe(true)

  list.scrollTop = 40
  await frame()
  await fill(5)
  expect(list.scrollTop).toBe(40)

  list.scrollTop = list.scrollHeight
  await frame()
  await fill(5)
  expect(atBottom(list)).toBe(true)
  expect(list.lastElementChild!.textContent).toContain('entry 4')
})

it('keeps following when the log is full and every new entry pushes the oldest out', async () => {
  const { list } = mount()
  await fill(300)
  expect(logs.value.length).toBe(300)
  // taller than the entries they push out, or the list would still sit at its bottom without anybody scrolling it
  for (let i = 0; i < 3; i++) log('tall\n\n\n')
  await nextTick()
  await frame()
  expect(logs.value.length).toBe(300)
  expect(atBottom(list)).toBe(true)
})

it('is at the bottom when its tab is shown again after entries arrived while it was hidden', async () => {
  const { list } = mount()
  await fill(30)
  selectTab('problems')
  await nextTick()
  expect(list.checkVisibility()).toBe(false)
  await fill(30)
  selectTab('log')
  await nextTick()
  await frame()
  expect(list.checkVisibility()).toBe(true)
  expect(atBottom(list)).toBe(true)
})

it('filters by level from the tab strip, and Clear empties the log', async () => {
  const { root, list } = mount()
  log('fine')
  log('careful', 'warn')
  log('broken', 'error')
  await nextTick()
  const rows = () => [...list.querySelectorAll('li[data-level]')].map((row) => row.getAttribute('data-level'))
  expect(root.querySelector('[data-dock="bottom"] [role="tablist"]')!.contains(action('[data-level="warn"]'))).toBe(true)
  expect(rows()).toEqual(['info', 'warn', 'error'])

  action('[data-level="warn"]').click()
  await nextTick()
  expect(rows()).toEqual(['warn', 'error'])
  expect(action('[data-level="warn"]').getAttribute('aria-pressed')).toBe('true')

  action('[data-level="error"]').click()
  await nextTick()
  expect(rows()).toEqual(['error'])

  action('[data-level="all"]').click()
  await nextTick()
  expect(rows()).toEqual(['info', 'warn', 'error'])

  action('.log-clear').click()
  await nextTick()
  expect(logs.value).toEqual([])
  expect(list.textContent).toContain('No log entries')
  expect(action('.log-clear').disabled).toBe(true)
})

it('the log actions leave the tab strip with the log tab', async () => {
  const { root } = mount()
  const strip = root.querySelector('[data-dock="bottom"] [role="tablist"]')!
  await nextTick()
  expect(strip.querySelector('.log-clear')).not.toBeNull()
  selectTab('performance')
  await nextTick()
  expect(strip.querySelector('.log-clear')).toBeNull()
  selectTab('log')
  await nextTick()
  expect(strip.querySelector('.log-clear')).not.toBeNull()
})

it('shows the level as text color only, with no header, card or icon, and the rows are selectable text', async () => {
  const { list } = mount()
  log('careful', 'warn')
  log('broken', 'error')
  await nextTick()
  const host = dockHost('log')
  expect(host.querySelector('header, h2, ubadge, uicon, svg, [class*="i-lucide"], [class*="rounded"]')).toBeNull()
  expect([...list.querySelectorAll('li[data-level] span')].map((el) => [...el.classList].filter((c) => /^text-(warning|error)$/.test(c)))).toEqual([
    ['text-warning'],
    ['text-error'],
  ])
  expect(list.classList.contains('select-text')).toBe(true)
})
