import { afterEach, expect, it } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import StatusBar from './StatusBar.vue'
import { useEngine } from '@/lib/engine/engine'

let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  if (useEngine().streaming.value) useEngine().toggleStream()
})

function mount() {
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(StatusBar) })
  // Nuxt UI is not installed here: its wrappers render as unknown elements that still show their default slot
  app.config.warnHandler = () => undefined
  app.mount(root)
  unmount = () => { app.unmount(); root.remove() }
  return root.querySelector<HTMLElement>('footer')!
}

it('leads with playback, then the device output, ahead of the status text', () => {
  const bar = mount()
  const order = [...bar.children].map((el) => ['transport', 'output'].find((name) => el.classList.contains(name)) ?? 'status')
  expect(order.slice(0, 3)).toEqual(['transport', 'output', 'status'])
  expect(bar.textContent).toContain('LEDs')
})

it('going live swaps the Stream label for the live indicator', async () => {
  const bar = mount()
  expect(bar.querySelector('.output')!.textContent).toContain('Stream')
  useEngine().toggleStream()
  await nextTick()
  expect(bar.querySelector('.output .live')).not.toBeNull()
  expect(bar.querySelector('.output')!.textContent).not.toContain('Stream')
})

it('the clock follows shader time and restarts on reset', async () => {
  const bar = mount()
  await new Promise((resolve) => setTimeout(resolve, 1250))
  const clock = bar.querySelector('.transport-clock')!
  expect(clock.textContent).toMatch(/^\d\d:\d\d\.\d$/)
  expect(clock.textContent! >= '00:01.0').toBe(true)
  useEngine().resetTime()
  await new Promise((resolve) => setTimeout(resolve, 250))
  expect(clock.textContent! < '00:01.0').toBe(true)
})
