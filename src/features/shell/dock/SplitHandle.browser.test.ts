import { afterEach, expect, it } from 'vitest'
import { cdp } from 'vitest/browser'
import { createApp, h, nextTick, ref } from 'vue'
import SplitHandle from './SplitHandle.vue'
import { dragBy } from '@/test/pointer'

let unmount: (() => void) | undefined
afterEach(() => unmount?.())

function mount(orientation: 'vertical' | 'horizontal', initial: number) {
  const size = ref(initial)
  const collapsed = ref(0)
  const root = document.createElement('div')
  root.style.cssText = `position: fixed; inset: 0; display: flex; flex-direction: ${orientation === 'vertical' ? 'row' : 'column'}`
  document.body.append(root)
  const app = createApp({
    render: () => [
      h('div', { style: 'flex: 1' }),
      h(SplitHandle, {
        orientation, min: 100, max: 300, initial: 200, label: 'Resize', modelValue: size.value,
        'onUpdate:modelValue': (next: number) => (size.value = next),
        onCollapse: () => collapsed.value++,
        // Tailwind is not loaded here, so the handle gets its thickness inline
        style: orientation === 'vertical' ? 'width: 6px' : 'height: 6px',
      }),
      h('div', { style: `flex: none; ${orientation === 'vertical' ? 'width' : 'height'}: ${size.value}px` }),
    ],
  })
  app.mount(root)
  unmount = () => { app.unmount(); root.remove() }
  return { size, collapsed, handle: root.querySelector<HTMLElement>('.split-handle')! }
}

// test/pointer.ts only drags along x
async function dragDown(el: Element, dy: number) {
  const frame = window.frameElement?.getBoundingClientRect()
  const rect = el.getBoundingClientRect()
  const x = rect.left + rect.width / 2 + (frame?.left ?? 0)
  const y = rect.top + rect.height / 2 + (frame?.top ?? 0)
  const send = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', at: number) => cdp().send('Input.dispatchMouseEvent', { type, x, y: at, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 })
  await send('mouseMoved', y)
  await send('mousePressed', y)
  for (let step = 1; step <= 4; step++) await send('mouseMoved', y + (dy * step) / 4)
  await send('mouseReleased', y + dy)
}

it('dragging toward the editor grows the panel by the distance dragged, away from it shrinks it', async () => {
  const { size, handle } = mount('vertical', 200)
  await dragBy(handle, -40)
  expect(size.value).toBe(240)
  await nextTick()
  await dragBy(handle, 70)
  expect(size.value).toBe(170)
})

it('stops at min and max', async () => {
  const { size, handle } = mount('vertical', 200)
  await dragBy(handle, -400)
  expect(size.value).toBe(300)
  await nextTick()
  await dragBy(handle, 230)
  expect(size.value).toBe(100)
})

it('a horizontal handle follows the pointer vertically', async () => {
  const { size, handle } = mount('horizontal', 200)
  await dragDown(handle, -60)
  expect(size.value).toBe(260)
})

it('dragging well below min asks to collapse and leaves the size where the drag began', async () => {
  const { size, collapsed, handle } = mount('vertical', 200)
  await dragBy(handle, 190)
  expect(collapsed.value).toBe(1)
  expect(size.value).toBe(200)
})

it('double click resets to the initial size', async () => {
  const { size, handle } = mount('vertical', 280)
  handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  expect(size.value).toBe(200)
})

it('arrow keys along its axis resize in 16px steps within the limits, other keys are left alone', async () => {
  const { size, handle } = mount('vertical', 290)
  const press = (key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    handle.dispatchEvent(event)
    return event.defaultPrevented
  }
  expect(press('ArrowLeft')).toBe(true)
  expect(size.value).toBe(300)
  await nextTick()
  press('ArrowRight')
  expect(size.value).toBe(284)
  expect(press('ArrowUp')).toBe(false)
  expect(size.value).toBe(284)
})

it('is a focusable separator that reports its value and limits', async () => {
  const { size, handle } = mount('horizontal', 150)
  expect(handle.getAttribute('role')).toBe('separator')
  expect(handle.tabIndex).toBe(0)
  expect(handle.getAttribute('aria-orientation')).toBe('horizontal')
  expect([handle.getAttribute('aria-valuemin'), handle.getAttribute('aria-valuenow'), handle.getAttribute('aria-valuemax')]).toEqual(['100', '150', '300'])
  size.value = 180
  await nextTick()
  expect(handle.getAttribute('aria-valuenow')).toBe('180')
})
