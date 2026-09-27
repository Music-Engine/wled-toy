import { expect, it } from 'vitest'
import { ref } from 'vue'
import { useGradientEditor } from './use-gradient-editor'
import type { ColorRamp } from '@/lib/graph/nodes/color/color-ramp'

const black = [0, 0, 0]
const red = [1, 0, 0]
const white = [1, 1, 1]

function editor() {
  const ramp = ref<ColorRamp>({ interpolation: 'linear', stops: [{ position: 0, color: black }, { position: 0.5, color: red }, { position: 1, color: white }] })
  return { ramp, ...useGradientEditor(() => ramp.value, (next) => (ramp.value = next)) }
}

it('a stop moved past its neighbour swaps places with it and stays selected', () => {
  const { ramp, selected, current, updateCurrent } = editor()
  updateCurrent({ position: 0.75 })
  expect(ramp.value.stops).toEqual([{ position: 0.5, color: red }, { position: 0.75, color: black }, { position: 1, color: white }])
  expect(selected.value).toBe(1)
  expect(current.value.color).toEqual(black)

  updateCurrent({ position: 0.25 })
  expect(ramp.value.stops.map((s) => s.color)).toEqual([black, red, white])
  expect(selected.value).toBe(0)
})

it('recoloring a stop keeps its place', () => {
  const { ramp, selected, updateCurrent } = editor()
  selected.value = 1
  updateCurrent({ color: white })
  expect(ramp.value.stops.map((s) => s.position)).toEqual([0, 0.5, 1])
  expect(ramp.value.stops[1].color).toEqual(white)
})
