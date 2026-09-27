import { afterEach, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { createApp, h } from 'vue'
import ShareAudioPrompt from './ShareAudioPrompt.vue'
import { useEngine } from '@/lib/engine/engine'

let unmount: (() => void) | undefined
afterEach(async () => {
  unmount?.()
  vi.restoreAllMocks()
  const audio = useEngine().audio
  audio.state.sharePrompt = false
  audio.state.error = null
  await audio.configure({ source: 'file' })
  audio.pause()
})

const prompt = () => document.querySelector<HTMLElement>('.share-audio-prompt')

it('Share Audio... asks the browser for the picker inside the click itself', async () => {
  const audio = useEngine().audio
  const root = document.createElement('div')
  document.body.append(root)
  const app = createApp({ render: () => h(ShareAudioPrompt) })
  app.mount(root)
  unmount = () => { app.unmount(); root.remove() }
  expect(prompt()).toBeNull()

  const microphone = await navigator.mediaDevices.getUserMedia({ audio: true })
  const activeAtRequest: boolean[] = []
  vi.spyOn(navigator.mediaDevices, 'getDisplayMedia').mockImplementation(async () => {
    activeAtRequest.push(navigator.userActivation.isActive)
    return microphone
  })
  audio.state.sharePrompt = true
  await expect.poll(() => prompt()).not.toBeNull()
  await userEvent.click(prompt()!.querySelector<HTMLElement>('[data-action="share"]')!)
  await expect.poll(() => audio.state.settings.source).toBe('loopback')
  expect(activeAtRequest).toEqual([true])
  expect([audio.state.sharePrompt, audio.state.error]).toEqual([false, null])
  await expect.poll(() => prompt()).toBeNull()
})
