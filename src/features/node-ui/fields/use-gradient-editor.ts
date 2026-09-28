import { computed, ref } from 'vue'
import { sampleRamp, type ColorRamp, type RampStop } from '@/lib/graph'

/**
 * The selected stop of a color ramp and the edits on it. Stops are kept ordered by position, so a stop's index is its
 * place along the bar; a stop moved past its neighbour swaps places with it and stays selected.
 */
export function useGradientEditor(ramp: () => ColorRamp, emit: (next: ColorRamp) => void) {
  const bar = ref<HTMLElement>()
  const selected = ref(0)
  let dragging = false

  const stops = computed(() => [...ramp().stops].sort((a, b) => a.position - b.position))
  const current = computed(() => stops.value[Math.min(selected.value, stops.value.length - 1)])

  function commit(next: RampStop[], select: RampStop) {
    const ordered = [...next].sort((a, b) => a.position - b.position)
    emit({ ...ramp(), stops: ordered })
    selected.value = ordered.indexOf(select)
  }

  function updateCurrent(patch: Partial<RampStop>) {
    const stop = { ...current.value, ...patch }
    commit(
      stops.value.map((s) => (s === current.value ? stop : s)),
      stop,
    )
  }

  function addStop(position?: number) {
    const index = stops.value.indexOf(current.value)
    const next = stops.value[index + 1]
    const at = position ?? (next ? (current.value.position + next.position) / 2 : Math.min(1, current.value.position + 0.1))
    const stop = { position: at, color: sampleRamp(ramp(), at) }
    commit([...stops.value, stop], stop)
  }

  function removeStop() {
    if (stops.value.length <= 2) return
    const index = stops.value.indexOf(current.value)
    const rest = stops.value.filter((_, i) => i !== index)
    commit(rest, rest[Math.max(0, index - 1)])
  }

  function positionAt(clientX: number) {
    const rect = bar.value!.getBoundingClientRect()
    return Math.round(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * 1000) / 1000
  }

  function onStopDown(index: number, e: PointerEvent) {
    selected.value = index
    dragging = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function onStopMove(e: PointerEvent) {
    if (dragging) updateCurrent({ position: positionAt(e.clientX) })
  }

  const onStopUp = () => (dragging = false)

  return { bar, selected, stops, current, updateCurrent, addStop, removeStop, positionAt, onStopDown, onStopMove, onStopUp }
}
