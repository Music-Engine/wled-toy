import { afterEach, expect, it } from 'vitest'
import { createApp, h } from 'vue'
import LiveIndicator from './LiveIndicator.vue'

let unmount: (() => void) | undefined
afterEach(() => unmount?.())

function mount() {
  // the two Nuxt UI tokens a solid primary or success button fills itself with
  document.documentElement.style.setProperty('--ui-primary', 'rgb(240, 110, 60)')
  document.documentElement.style.setProperty('--ui-success', 'rgb(40, 200, 90)')
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(LiveIndicator) })
  app.mount(root)
  unmount = () => { app.unmount(); root.remove() }
  return root.querySelector<HTMLElement>('.live')!
}

it('is not a filled button: no background, no primary or success fill class', () => {
  const live = mount()
  expect(getComputedStyle(live).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  expect([...live.classList, ...[...live.querySelectorAll('*')].flatMap((el) => [...el.classList])].filter((c) => /^bg-(success|primary)/.test(c))).toEqual([])
})

it('marks live with an ember dot that pulses forever, never the green of link health', () => {
  const dot = mount().querySelector('.live-dot')!
  expect(getComputedStyle(dot).backgroundColor).toBe('rgb(240, 110, 60)')
  const halo = getComputedStyle(dot, '::after')
  expect(halo.animationName).not.toBe('none')
  expect(halo.animationIterationCount).toBe('infinite')
})

it('reads "Live" with the sent and target frame rate', () => {
  const live = mount()
  expect(live.querySelector('.live-label')!.textContent).toBe('Live')
  expect(live.querySelector('.live-readout')!.textContent).toMatch(/^\d+\/\d+ fps$/)
})
