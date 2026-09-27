import { expect, it } from 'vitest'
import { classifyWheel, type WheelSample } from './use-wheel-zoom'

const sample = (partial: Partial<WheelSample>): WheelSample => ({ deltaX: 0, deltaY: 0, deltaMode: 0, timeStamp: 0, ...partial })
const first = (partial: Partial<WheelSample>) => classifyWheel(sample(partial), null).source

it('a wheel notch on Windows and Linux is a wheel whatever the display scale makes of its pixels', () => {
  expect(first({ deltaY: 100, wheelDeltaY: -120 })).toBe('wheel')
  expect(first({ deltaY: -66.66667175292969, wheelDeltaY: 120 })).toBe('wheel')
  expect(first({ deltaY: 300, wheelDeltaY: -360 })).toBe('wheel')
})

it('a slow wheel notch on macOS is a wheel: a fixed-point line count times 40 px', () => {
  expect(first({ deltaY: 4.000244140625, wheelDeltaY: -12 })).toBe('wheel')
  expect(first({ deltaY: -4.000244140625, wheelDeltaY: 12 })).toBe('wheel')
  expect(first({ deltaY: (19661 * 40) / 65536, wheelDeltaY: -36 })).toBe('wheel')
})

it('scrolling by lines or pages is a wheel', () => {
  expect(first({ deltaY: 3, deltaMode: 1 })).toBe('wheel')
  expect(first({ deltaY: 1, deltaMode: 2 })).toBe('wheel')
})

it('small whole or half-point deltas are a trackpad', () => {
  expect(first({ deltaY: 1, wheelDeltaY: -3 })).toBe('trackpad')
  expect(first({ deltaY: -7, wheelDeltaY: 21 })).toBe('trackpad')
  expect(first({ deltaY: 2.5, wheelDeltaY: -7 })).toBe('trackpad')
  expect(first({ deltaY: 0.8333333730697632, wheelDeltaY: -1 })).toBe('trackpad')
})

it('any sideways movement is a trackpad, and so is a wheel the OS turned sideways with Shift', () => {
  expect(first({ deltaX: 2, deltaY: 100, wheelDeltaY: -120 })).toBe('trackpad')
  expect(first({ deltaX: 100, deltaY: 0, wheelDeltaY: 0 })).toBe('trackpad')
})

it('the first event of a gesture decides: a wheel-like delta in the tail of a trackpad scroll stays a trackpad', () => {
  const start = classifyWheel(sample({ deltaY: 2, wheelDeltaY: -6, timeStamp: 1000 }), null)
  const tail = classifyWheel(sample({ deltaY: 40, wheelDeltaY: -120, timeStamp: 1016 }), start)
  expect(tail).toEqual({ source: 'trackpad', timeStamp: 1016 })
  expect(classifyWheel(sample({ deltaY: 40, wheelDeltaY: -120, timeStamp: 1150 }), tail).source).toBe('trackpad')
})

it('after a pause the next event is judged afresh', () => {
  const trackpad = classifyWheel(sample({ deltaY: 2, wheelDeltaY: -6, timeStamp: 1000 }), null)
  expect(classifyWheel(sample({ deltaY: 100, wheelDeltaY: -120, timeStamp: 1200 }), trackpad).source).toBe('wheel')
  const wheel = classifyWheel(sample({ deltaY: 100, wheelDeltaY: -120, timeStamp: 2000 }), null)
  expect(classifyWheel(sample({ deltaY: 3, wheelDeltaY: -9, timeStamp: 2100 }), wheel).source).toBe('wheel')
  expect(classifyWheel(sample({ deltaY: 3, wheelDeltaY: -9, timeStamp: 2400 }), wheel).source).toBe('trackpad')
})
