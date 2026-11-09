import { cdp } from 'vitest/browser'

// Tests run inside an iframe, while the browser's input pipeline takes top-level viewport coordinates.
function toViewport(x: number, y: number) {
  const frame = window.frameElement?.getBoundingClientRect()
  return { x: x + (frame?.left ?? 0), y: y + (frame?.top ?? 0) }
}

const mouse = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', x: number, y: number, shift = false) =>
  cdp().send('Input.dispatchMouseEvent', {
    type,
    ...toViewport(x, y),
    button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: 1,
    modifiers: shift ? 8 : 0,
  })

/**
 * Presses at the element's center (or `from` fraction of its width), moves by `dx` CSS pixels in steps, and releases.
 * Real browser input, so pointer capture works the way it does for a user.
 */
export async function dragBy(el: Element, dx: number, { from = 0.5, shift = false } = {}) {
  const rect = el.getBoundingClientRect()
  const x = rect.left + rect.width * from
  const y = rect.top + rect.height / 2
  await mouse('mouseMoved', x, y)
  await mouse('mousePressed', x, y)
  for (let step = 1; step <= 4; step++) await mouse('mouseMoved', x + (dx * step) / 4, y, shift)
  await mouse('mouseReleased', x + dx, y)
}

export const click = (el: Element) => dragBy(el, 0)
