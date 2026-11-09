import { afterEach, expect, it } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import AudioPreview from './AudioPreview.vue'
import { useEngine } from '@/lib/engine/engine'

let unmount: (() => void) | undefined
afterEach(() => unmount?.())

it('a long song name is truncated beside the button instead of pushing it onto two lines', async () => {
  const { audio } = useEngine()
  audio.state.fileName = "Don't Leave Me on the Dance Floor (Extended Club Mix) [Remastered 2024].mp3"
  const root = document.createElement('div')
  // the width of a node body
  root.className = 'nui'
  root.style.cssText = 'width: 260px'
  document.body.append(root)
  const app = createApp({ render: () => h(AudioPreview, { nodeId: 'a', values: {} }) })
  app.mount(root)
  unmount = () => {
    app.unmount()
    root.remove()
  }
  await nextTick()

  const button = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Choose Song'))!
  const name = root.querySelector('.nui-audio-file')!
  const [b, n, row] = [button.getBoundingClientRect(), name.getBoundingClientRect(), button.parentElement!.getBoundingClientRect()]
  // the button has a fixed height, so a wrapped label shows up as content taller or wider than its box
  expect(button.scrollHeight).toBeLessThanOrEqual(button.clientHeight + 1)
  expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth)
  expect(n.left).toBeGreaterThanOrEqual(b.right)
  expect(n.right).toBeLessThanOrEqual(row.right + 0.5)
  expect(name.scrollWidth).toBeGreaterThan(name.clientWidth)
  expect(name.getAttribute('title')).toContain('Dance Floor')
})
