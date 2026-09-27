import { afterEach, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createApp, h, nextTick, ref } from 'vue'
import FileSelector, { type FileListing } from './FileSelector.vue'

let unmount: (() => void) | undefined
afterEach(() => unmount?.())

function mount(initial: string | null) {
  const files = ref<FileListing[]>([{ id: 'builtin', name: 'Built-in image', fixed: true }, { id: 'cat.png', name: 'cat.png' }, { id: 'dog.png', name: 'Dog' }])
  const selected = ref(initial)
  const events: unknown[][] = []
  const root = document.createElement('div')
  root.className = 'nui'
  root.style.cssText = 'width: 260px'
  document.body.append(root)
  const app = createApp({
    render: () => h(FileSelector, {
      modelValue: selected.value, files: files.value, label: 'Image', accept: 'image/*', linkable: true,
      'onUpdate:modelValue': (id: string | null) => (selected.value = id),
      onRename: (id: string, name: string) => events.push(['rename', id, name]),
      onLink: (url: string) => events.push(['link', url]),
      onUpload: (file: File) => events.push(['upload', file.name]),
    }),
  })
  app.mount(root)
  unmount = () => { app.unmount(); root.remove() }
  const button = (label: string) => root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
  return { root, selected, events, button }
}

it('picks a file from the list, filtered by the search box', async () => {
  const { root, selected, button } = mount(null)
  button('Browse Image').click()
  await nextTick()
  expect([...root.querySelectorAll('.nui-file-item')].map((el) => el.textContent?.trim())).toEqual(['Built-in image', 'cat.png', 'Dog'])
  await userEvent.keyboard('do')
  expect([...root.querySelectorAll('.nui-file-item')].map((el) => el.textContent?.trim())).toEqual(['Dog'])
  await userEvent.keyboard('{Enter}')
  expect(selected.value).toBe('dog.png')
  expect(root.querySelector('.nui-file-menu')).toBeNull()
})

it('renames the chosen file on Enter, but not a built-in one', async () => {
  const { root, events } = mount('cat.png')
  await nextTick()
  const name = root.querySelector<HTMLInputElement>('.nui-file-name')!
  expect(name.readOnly).toBe(false)
  await userEvent.fill(name, 'Whiskers')
  await userEvent.keyboard('{Enter}')
  expect(events).toEqual([['rename', 'cat.png', 'Whiskers']])

  unmount?.()
  const builtIn = mount('builtin')
  await nextTick()
  expect(builtIn.root.querySelector<HTMLInputElement>('.nui-file-name')!.readOnly).toBe(true)
})

it('links a URL, and clears the choice', async () => {
  const { selected, events, button } = mount('cat.png')
  await nextTick()
  button('Link an image by URL').click()
  await nextTick()
  await userEvent.keyboard('https://example.com/a.png{Enter}')
  expect(events).toEqual([['link', 'https://example.com/a.png']])
  button('Clear').click()
  expect(selected.value).toBeNull()
})

it('fits the node: no button wraps or overflows the row', async () => {
  const { root } = mount('cat.png')
  await nextTick()
  const row = root.querySelector('.nui-button-group')!
  expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth)
  for (const button of root.querySelectorAll('button')) expect(button.scrollHeight).toBeLessThanOrEqual(button.clientHeight + 1)
})
