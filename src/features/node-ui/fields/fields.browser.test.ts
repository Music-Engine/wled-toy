import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { nextTick } from 'vue'
import DropdownField from './DropdownField.vue'
import GradientEditor from './GradientEditor.vue'
import RangeField from './RangeField.vue'
import { click, dragBy } from '@/test/pointer'
import { mountField } from '@/test/mount'
import { defaultRamp, type ColorRamp } from '@/lib/graph'

let mounted: { unmount(): void } | undefined
afterEach(() => mounted?.unmount())

describe('RangeField', () => {
  it('a bounded field scrubs its whole range across its width, and Shift slows it tenfold', async () => {
    const field = mountField(RangeField, 0, { min: 0, max: 1 })
    mounted = field
    const text = field.root.querySelector('.nui-range-text')!
    await dragBy(text, 50, { from: 0.25 })
    expect(field.value.value).toBeCloseTo(0.25, 1)
    const before = field.value.value
    await dragBy(text, 50, { from: 0.25, shift: true })
    expect(field.value.value - before).toBeCloseTo(0.025, 2)
  })

  it('clamps a drag past the end', async () => {
    const field = mountField(RangeField, 0.9, { min: 0, max: 1 })
    mounted = field
    await dragBy(field.root.querySelector('.nui-range-text')!, 150, { from: 0.1 })
    expect(field.value.value).toBe(1)
  })

  it('a click opens a text box: Enter commits, Escape cancels, junk is refused', async () => {
    const field = mountField(RangeField, 2, {})
    mounted = field
    const open = async () => {
      await click(field.root.querySelector('.nui-range-text')!)
      await nextTick()
      return field.root.querySelector('input')!
    }
    await userEvent.fill(await open(), '7.5')
    await userEvent.keyboard('{Enter}')
    expect(field.value.value).toBe(7.5)

    await userEvent.fill(await open(), '99')
    await userEvent.keyboard('{Escape}')
    expect(field.value.value).toBe(7.5)

    await userEvent.fill(await open(), 'abc')
    await userEvent.keyboard('{Enter}')
    expect(field.value.value).toBe(7.5)
    expect(field.root.querySelector('.is-invalid')).not.toBeNull()
  })

  it('steppers move by step and respect the bounds', async () => {
    const field = mountField(RangeField, 3, { min: 0, max: 4, step: 1, decimals: 0 })
    mounted = field
    const [down, up] = field.root.querySelectorAll<HTMLElement>('.nui-range-step')
    up.click()
    await nextTick()
    up.click()
    expect(field.value.value).toBe(4)
    down.click()
    expect(field.value.value).toBe(3)
  })
})

describe('DropdownField', () => {
  const options = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }, { value: 'c', label: 'Gamma' }]

  it('marks the current option and picks another by keyboard', async () => {
    const field = mountField(DropdownField, 'b', { options })
    mounted = field
    const button = field.root.querySelector('button')!
    button.focus()
    await userEvent.keyboard('{Enter}')
    expect(document.querySelector('.nui-dropdown-menu .is-selected')?.textContent?.trim()).toBe('Beta')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(field.value.value).toBe('c')
    expect(document.querySelector('.nui-dropdown-menu')).toBeNull()
  })

  it('closes on Escape and on a press outside without changing the value', async () => {
    const field = mountField(DropdownField, 'a', { options })
    mounted = field
    // a real press, so the button takes focus the way it does for a user and the key lands inside the field
    await click(field.root.querySelector('button')!)
    await nextTick()
    await userEvent.keyboard('{Escape}')
    expect(document.querySelector('.nui-dropdown-menu')).toBeNull()
    field.root.querySelector('button')!.click()
    await nextTick()
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    await nextTick()
    expect(document.querySelector('.nui-dropdown-menu')).toBeNull()
    expect(field.value.value).toBe('a')
  })
})

describe('DropdownField popup', () => {
  const plain = (count: number) => Array.from({ length: count }, (_, i) => ({ value: `v${i}`, label: `Option ${i}` }))
  const columnSizes = () => [...document.querySelectorAll('.nui-dropdown-column')].map((column) => column.querySelectorAll('[role=option]').length)
  const open = async (options: { value: string; label: string; group?: string }[], value: string) => {
    const field = mountField(DropdownField, value, { options })
    mounted = field
    field.root.querySelector('button')!.focus()
    await userEvent.keyboard('{Enter}')
    return field
  }

  it('keeps up to 8 plain options in one column and splits more into even columns of at most 12', async () => {
    await open(plain(8), 'v0')
    expect(columnSizes()).toEqual([8])
    mounted!.unmount()
    await open(plain(9), 'v0')
    expect(columnSizes()).toEqual([9])
    mounted!.unmount()
    await open(plain(26), 'v0')
    expect(columnSizes()).toEqual([9, 9, 8])
  })

  it('gathers grouped options under one heading per group, in the order groups first appear', async () => {
    await open([{ value: 'a', label: 'Add', group: 'Functions' }, { value: 's', label: 'Sine', group: 'Trigonometric' }, { value: 'm', label: 'Multiply', group: 'Functions' }], 'a')
    expect([...document.querySelectorAll('.nui-dropdown-heading')].map((el) => el.textContent)).toEqual(['Functions', 'Trigonometric'])
    expect(columnSizes()).toEqual([2, 1])
  })

  it('arrows move down a column, into the next one, and sideways; typing jumps to the first match', async () => {
    const field = await open(plain(26), 'v0')
    const active = () => document.querySelector('.nui-dropdown-option.is-active')?.textContent?.trim()
    await userEvent.keyboard('{ArrowRight}')
    expect(active()).toBe('Option 9')
    await userEvent.keyboard('{ArrowUp}')
    expect(active(), 'up from the top of a column is the bottom of the one before').toBe('Option 8')
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    expect(active(), 'the last column is shorter, so the row clamps').toBe('Option 25')
    await userEvent.keyboard('option 13')
    expect(active()).toBe('Option 13')
    await userEvent.keyboard('{Enter}')
    expect(field.value.value).toBe('v13')
  })

  it('stays inside the window when its field sits at the right or bottom edge', async () => {
    const field = mountField(DropdownField, 'v0', { options: plain(26) })
    mounted = field
    field.root.style.cssText = 'position: fixed; right: 0; bottom: 0; width: 120px; margin: 0'
    field.root.querySelector('button')!.click()
    await expect.poll(() => document.querySelector<HTMLElement>('.nui-dropdown-menu')?.style.left).toBeTruthy()
    const box = document.querySelector('.nui-dropdown-menu')!.getBoundingClientRect()
    expect(box.width).toBeGreaterThan(120)
    expect(box.right).toBeLessThanOrEqual(window.innerWidth)
    expect(box.bottom).toBeLessThanOrEqual(window.innerHeight)
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.top).toBeGreaterThanOrEqual(0)
  })
})

describe('GradientEditor', () => {
  const threeStops = (): ColorRamp => ({ interpolation: 'linear', stops: [{ position: 0, color: [0, 0, 0] }, { position: 0.5, color: [1, 0, 0] }, { position: 1, color: [1, 1, 1] }] })

  it('adds a stop midway after the selected one with the color the ramp has there', async () => {
    const field = mountField(GradientEditor, defaultRamp())
    mounted = field
    field.root.querySelector<HTMLElement>('[aria-label="Add stop"]')!.click()
    await nextTick()
    expect(field.value.value.stops.map((s) => s.position)).toEqual([0, 0.5, 1])
    expect(field.value.value.stops[1].color).toEqual([0.5, 0.5, 0.5])
  })

  it('never goes below two stops', async () => {
    const field = mountField(GradientEditor, threeStops())
    mounted = field
    const remove = field.root.querySelector<HTMLButtonElement>('[aria-label="Remove stop"]')!
    remove.click()
    await nextTick()
    expect(field.value.value.stops).toHaveLength(2)
    expect(remove.disabled).toBe(true)
  })

  it('a stop dragged past its neighbor swaps places with it, and the ramp stays sorted', async () => {
    const field = mountField(GradientEditor, threeStops())
    mounted = field
    const first = field.root.querySelectorAll('.nui-gradient-stop')[0]
    await dragBy(first, 150)
    const positions = field.value.value.stops.map((s) => s.position)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(positions[1]).toBeGreaterThan(0.5)
    expect(field.value.value.stops.map((s) => s.color)).toEqual([[1, 0, 0], [0, 0, 0], [1, 1, 1]])
  })
})
