import { afterEach, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createApp, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import LaunchScreen from './LaunchScreen.vue'
import { registerHandlers } from '@/lib/app/commands'
import { config } from '@/lib/app/config'
import { EXAMPLES } from '@/lib/shader/examples'
import { launchScreen, preferences, resetPreferences } from '@/lib/app/preferences'
import { version } from '@/lib/app/version'

const cleanups: Array<() => void> = []
afterEach(async () => {
  launchScreen.open = false
  await nextTick()
  cleanups.splice(0).forEach((cleanup) => cleanup())
  localStorage.removeItem('wledtoy:graph:recent')
  resetPreferences()
})

function mount() {
  const page = { render: () => null }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: page }, { path: '/graph', component: page }] })
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(LaunchScreen) }).use(router)
  app.mount(root)
  cleanups.push(() => { app.unmount(); root.remove() })
  return router
}

const screen = () => document.querySelector<HTMLElement>('.launch-screen')
const action = (name: string) => screen()!.querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!

it('stays away until it is opened, names the app and its version, and offers new, open, recent files and examples', async () => {
  mount()
  expect(screen()).toBeNull()
  launchScreen.open = true
  await expect.poll(() => screen()).not.toBeNull()
  expect(screen()!.getAttribute('role')).toBe('dialog')
  expect(screen()!.querySelector('h2')!.textContent).toBe('WLEDtoy')
  expect(screen()!.querySelector('[data-value="version"]')!.textContent).toBe(version)
  expect([...screen()!.querySelectorAll('h3')].map((el) => el.textContent)).toEqual(['New', 'Open', 'Recent Files', 'Examples'])
  expect([action('new-shader'), action('new-graph'), action('open')].map((el) => el.textContent!.trim())).toEqual(['Shader', 'Graph', 'Open...'])
  expect(screen()!.textContent).toContain('No recent files')
  expect([...screen()!.querySelectorAll<HTMLElement>('[data-example]')].map((el) => el.dataset.example)).toEqual(EXAMPLES.slice(0, 5).map((example) => example.name))
  expect(screen()!.querySelector('img')).toBeNull()
})

it('Escape and a click outside dismiss it', async () => {
  mount()
  launchScreen.open = true
  await expect.poll(() => screen()).not.toBeNull()
  await userEvent.keyboard('{Escape}')
  expect(launchScreen.open).toBe(false)

  launchScreen.open = true
  await expect.poll(() => screen()).not.toBeNull()
  // without the app's stylesheet the overlay has no size to click on; the press itself is what the dialog listens for
  await new Promise((resolve) => setTimeout(resolve, 50))
  document.querySelector('.launch-overlay')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  await expect.poll(() => launchScreen.open).toBe(false)
})

it('Open... goes to graph mode, runs file.open once the page has bound it, and dismisses', async () => {
  const router = mount()
  launchScreen.open = true
  await expect.poll(() => screen()).not.toBeNull()
  const open = vi.fn()
  await userEvent.click(action('open'))
  expect(launchScreen.open).toBe(false)
  await expect.poll(() => router.currentRoute.value.path).toBe('/graph')
  expect(open).not.toHaveBeenCalled()
  // the graph page binds its handlers when it mounts, after the navigation
  cleanups.push(registerHandlers({ 'file.open': open }))
  await expect.poll(() => open.mock.calls.length).toBe(1)
})

it('an example loads into the shader and dismisses', async () => {
  const before = config.code
  cleanups.push(() => { config.code = before })
  const router = mount()
  await router.push('/graph')
  launchScreen.open = true
  await expect.poll(() => screen()).not.toBeNull()
  await userEvent.click(screen()!.querySelector<HTMLElement>('[data-example="Fire"]')!)
  await expect.poll(() => config.code).toBe(EXAMPLES.find((example) => example.name === 'Fire')!.code)
  expect([launchScreen.open, router.currentRoute.value.path]).toEqual([false, '/'])
})

it('lists at most eight recent files, newest first, from what the graph document stored', async () => {
  localStorage.setItem('wledtoy:graph:recent', JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ name: `show-${i}.wledgraph`, openedAt: new Date(0).toISOString() }))))
  mount()
  launchScreen.open = true
  await expect.poll(() => screen()).not.toBeNull()
  expect([...screen()!.querySelectorAll<HTMLElement>('[data-recent]')].map((el) => el.dataset.recent)).toEqual(Array.from({ length: 8 }, (_, i) => `show-${i}.wledgraph`))
  expect(screen()!.textContent).not.toContain('No recent files')
})

it('the Show on launch box writes the preference', async () => {
  mount()
  launchScreen.open = true
  await expect.poll(() => screen()).not.toBeNull()
  const box = screen()!.querySelector<HTMLInputElement>('[data-field="showLaunchScreen"]')!
  expect([box.checked, preferences.showLaunchScreen]).toEqual([true, true])
  await userEvent.click(box)
  expect(preferences.showLaunchScreen).toBe(false)
  expect(launchScreen.open).toBe(true)
})
