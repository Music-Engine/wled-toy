import { afterEach, expect, it } from 'vitest'
import { KeepAlive, createApp, h, nextTick } from 'vue'
import ReferencePage from './ReferencePage.vue'
import { setClipboardWriter } from '@/lib/app/clipboard'
import { installKeyDispatcher, isMac } from '@/lib/app/commands'
import { workspace } from '@/lib/app/workspace'
import { CATEGORIES, NODES } from '@/lib/shader/glsl'

let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  workspace.mode = 'shader'
  setClipboardWriter((text) => { void navigator.clipboard.writeText(text) })
})

function mount() {
  workspace.mode = 'reference'
  const root = document.createElement('div')
  root.style.height = '600px'
  document.body.append(root)
  const app = createApp({ render: () => h(KeepAlive, () => h(ReferencePage)) })
  // Nuxt UI is not installed here; ReferencePage uses only native elements plus GlslCode, CommandScope and the reference components, none of which needs it
  app.config.warnHandler = () => undefined
  app.mount(root)
  const removeKeys = installKeyDispatcher()
  unmount = () => { removeKeys(); app.unmount(); root.remove() }
  return root
}

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
}

const mod = isMac() ? { metaKey: true } : { ctrlKey: true }
const search = (root: HTMLElement) => root.querySelector<HTMLInputElement>('input')!
const categoryOptions = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('[role="option"]')]
const entryNames = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[data-entry]')].map((el) => el.dataset.entry)

it('has no cards: categories are a row list on the left, entries a document on the right', () => {
  const root = mount()
  expect(root.querySelector('article, [class*="rounded-lg"][class*="border"], [class*="shadow-md"], [class*="shadow-lg"]')).toBeNull()
  const categories = categoryOptions(root)
  expect(categories.length).toBeGreaterThan(1)
  expect(categories[0].textContent).toContain('All')
  expect(entryNames(root).length).toBe(NODES.length)
})

it('groups entries under one section header per category that has entries, in category order', async () => {
  const root = mount()
  const populated = CATEGORIES.filter((c) => NODES.some((n) => n.category === c.id))
  const headers = [...root.querySelectorAll('section > h2')]
  expect(headers.map((h) => h.textContent!.replace(/\d+/g, '').trim())).toEqual(populated.map((c) => c.label))
  expect(headers.every((h) => h.classList.contains('sticky'))).toBe(true)

  const audio = root.querySelector('section[aria-label="Audio"]')!
  expect([...audio.querySelectorAll<HTMLElement>('[data-entry]')].map((el) => el.dataset.entry)).toEqual(NODES.filter((n) => n.category === 'audio').map((n) => n.name))
  expect(categoryOptions(root).some((el) => el.textContent!.includes('Converter'))).toBe(false)
})

it('renders an entry as title, signature, description, a parameter definition list and the return value', () => {
  const root = mount()
  const entry = root.querySelector<HTMLElement>('[data-entry="bandLevel"]')!
  expect(entry.querySelector('h3')!.textContent).toBe('Audio Band')
  expect(entry.querySelector('code')!.textContent).toBe('float bandLevel(float low, float high)')

  const rows = [...entry.querySelectorAll('dl[data-params] > div')].map((row) => [...row.children].map((cell) => `${cell.tagName}:${cell.textContent!.trim()}`))
  expect(rows).toEqual([
    ['DT:low', 'DD:float', 'DD:= 0.0', 'DD:0 to 1'],
    ['DT:high', 'DD:float', 'DD:= 1.0', 'DD:0 to 1'],
  ])
  expect(entry.querySelector('dl[data-returns]')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('level float')

  expect(root.querySelector('[data-entry="bass"] dl[data-params]')).toBeNull()
  expect(root.querySelector('[data-entry="iTime"] dl')).toBeNull()
  expect(root.querySelector('[data-entry="gammaCorrect"] dl[data-params]')!.textContent).toContain('required')
})

it('selecting a category filters the entry list to that category only', async () => {
  const root = mount()
  const audio = categoryOptions(root).find((el) => el.textContent!.includes('Audio'))!
  audio.click()
  await nextTick()
  const expected = NODES.filter((n) => n.category === 'audio').map((n) => n.name)
  expect(entryNames(root)).toEqual(expected)
  expect(audio.getAttribute('aria-selected')).toBe('true')
})

it('search narrows the entry list and the header count, across every category', async () => {
  const root = mount()
  const input = search(root)
  input.value = 'fftlog'
  input.dispatchEvent(new Event('input'))
  await nextTick()
  expect(entryNames(root)).toEqual(['fftLog'])
  expect(root.textContent).toContain(`1 of ${NODES.length} entry`)
  const counts = Object.fromEntries(categoryOptions(root).map((el) => [el.children[1].textContent, el.children[2].textContent]))
  expect(counts).toMatchObject({ All: '1', Audio: '1', Color: '0' })
})

it('search highlights the match in the title, the name and the description', async () => {
  const root = mount()
  const input = search(root)
  input.value = 'wave'
  input.dispatchEvent(new Event('input'))
  await nextTick()
  const entry = root.querySelector<HTMLElement>('[data-entry="sawWave"]')!
  expect([...entry.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['Wave', 'Wave', 'Wave'])
  expect(root.querySelector('[data-entry="iAudio"] p mark')!.textContent).toBe('wave')
})

it('an empty result names the query and offers the way out', async () => {
  const root = mount()
  categoryOptions(root).find((el) => el.textContent!.includes('Color'))!.click()
  const input = search(root)
  input.value = 'fftlog'
  input.dispatchEvent(new Event('input'))
  await nextTick()
  const empty = root.querySelector<HTMLElement>('[data-empty]')!
  expect(empty.textContent).toContain('No entries match "fftlog"')

  const [showAll] = [...empty.querySelectorAll('button')]
  expect(showAll.textContent).toContain('Show 1 in all categories')
  showAll.click()
  await nextTick()
  expect(entryNames(root)).toEqual(['fftLog'])

  input.value = 'zzzz'
  input.dispatchEvent(new Event('input'))
  await nextTick()
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-empty] button')]
  expect(buttons.map((b) => b.textContent!.trim())).toEqual(['Clear search'])
  buttons[0].click()
  await nextTick()
  expect(entryNames(root).length).toBe(NODES.length)
  expect(document.activeElement).toBe(input)
})

it('Escape clears the search and restores the full list', async () => {
  const root = mount()
  const input = search(root)
  input.value = 'fftlog'
  input.dispatchEvent(new Event('input'))
  await nextTick()
  expect(entryNames(root).length).toBe(1)

  press(input, 'Escape')
  await nextTick()
  expect(input.value).toBe('')
  expect(entryNames(root).length).toBe(NODES.length)
})

it('the category list is arrow-key navigable and moves focus with the selection', async () => {
  const root = mount()
  const list = root.querySelector('[role="listbox"]')!
  const options = categoryOptions(root)
  expect(options[0].getAttribute('aria-selected')).toBe('true')

  press(list, 'ArrowDown')
  await nextTick()
  expect(options[1].getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(options[1])

  press(list, 'ArrowUp')
  await nextTick()
  expect(options[0].getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement).toBe(options[0])

  // does not run out of bounds at the top
  press(list, 'ArrowUp')
  await nextTick()
  expect(options[0].getAttribute('aria-selected')).toBe('true')
})

it('arrow keys move focus between entries, across section boundaries', async () => {
  const root = mount()
  const names = entryNames(root)
  const first = root.querySelector<HTMLElement>(`[data-entry="${names[0]}"]`)!
  first.focus()
  press(first, 'ArrowDown')
  expect((document.activeElement as HTMLElement).dataset.entry).toBe(names[1])
  press(document.activeElement!, 'ArrowUp')
  press(document.activeElement!, 'ArrowUp')
  expect(document.activeElement).toBe(first)

  const lastInput = NODES.filter((n) => n.category === 'input').at(-1)!.name
  const boundary = root.querySelector<HTMLElement>(`[data-entry="${lastInput}"]`)!
  boundary.focus()
  press(boundary, 'ArrowDown')
  expect((document.activeElement as HTMLElement).dataset.entry).toBe(names[names.indexOf(lastInput) + 1])
  expect(document.activeElement!.closest('section')).not.toBe(boundary.closest('section'))
})

it('the on this page index lists every visible entry and jumps to the one clicked', async () => {
  const root = mount()
  const items = [...root.querySelectorAll<HTMLButtonElement>('nav [data-index-entry]')]
  expect(items.map((el) => el.dataset.indexEntry)).toEqual(entryNames(root))
  items.find((el) => el.dataset.indexEntry === 'kelvin')!.click()
  expect((document.activeElement as HTMLElement).dataset.entry).toBe('kelvin')
})

it('the Copy action on a row writes the signature through the injected clipboard writer', async () => {
  const root = mount()
  const written: string[] = []
  setClipboardWriter((text) => { written.push(text) })

  const row = root.querySelector<HTMLElement>('[data-entry="bass"]')!
  row.querySelector<HTMLButtonElement>('button')!.click()
  await nextTick()
  const node = NODES.find((n) => n.name === 'bass')!
  expect(written).toEqual([node.signature])
})

it('Enter on a focused row copies it, and Cmd/Ctrl+C copies whichever row has focus', async () => {
  const root = mount()
  const written: string[] = []
  setClipboardWriter((text) => { written.push(text) })

  const row = root.querySelector<HTMLElement>('[data-entry="bass"]')!
  row.focus()
  press(row, 'Enter')
  await nextTick()
  const node = NODES.find((n) => n.name === 'bass')!
  expect(written).toEqual([node.signature])

  // Enter on the Copy button is the button's own click, not a second copy from the row
  press(row.querySelector('button')!, 'Enter')
  await nextTick()
  expect(written).toEqual([node.signature])

  // the key still bubbles from whichever row the browser has focused, not from window itself
  press(row, 'c', mod)
  await nextTick()
  expect(written).toEqual([node.signature, node.signature])
})

it('Cmd/Ctrl+C is left alone when nothing reference-specific has focus', async () => {
  const root = mount()
  const written: string[] = []
  setClipboardWriter((text) => { written.push(text) })
  const input = search(root)
  input.focus()
  press(input, 'c', mod)
  await nextTick()
  expect(written).toEqual([])
})
