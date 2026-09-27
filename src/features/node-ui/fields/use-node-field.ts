import { computed, nextTick, reactive, ref, type Ref } from 'vue'

export interface NumberFieldProps {
  modelValue: number
  min: number
  max: number
  decimals: number
}

/**
 * A number edited in place: dragged sideways to scrub, or clicked to type, committed on Enter or blur. The value is
 * rounded and clamped before it is emitted; typed junk is refused and reported as invalid until the next good value.
 */
export function useNodeField(props: NumberFieldProps, emitValue: (value: number) => void, emitInvalid: (invalid: boolean) => void, input: Ref<HTMLInputElement | undefined>) {
  const editing = ref(false)
  const pressed = ref(false)
  const text = ref('')
  const { invalid, mark } = useInvalidParts(emitInvalid)
  let drag: { x: number; start: number; width: number; moved: boolean } | null = null

  const bounded = computed(() => Number.isFinite(props.min) && Number.isFinite(props.max))
  const display = computed(() => String(Number(props.modelValue.toFixed(props.decimals))))
  const fill = computed(() => (bounded.value ? `${Math.min(1, Math.max(0, (props.modelValue - props.min) / (props.max - props.min))) * 100}%` : '0'))

  function set(value: number) {
    const rounded = Number(value.toFixed(props.decimals))
    emitValue(Math.min(props.max, Math.max(props.min, rounded)))
    mark(0, false)
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    const target = e.currentTarget as HTMLElement
    drag = { x: e.clientX, start: props.modelValue, width: target.getBoundingClientRect().width, moved: false }
    target.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) return
    const dx = e.clientX - drag.x
    if (!drag.moved && Math.abs(dx) < 3) return
    drag.moved = true
    pressed.value = true
    // a bounded field maps its width to its range; an unbounded one scales with magnitude so 2700 K and 0.05 both scrub well
    const perPixel = bounded.value ? (props.max - props.min) / drag.width : Math.max(0.005, Math.abs(drag.start) * 0.01)
    set(drag.start + dx * perPixel * (e.shiftKey ? 0.1 : 1))
  }

  async function onPointerUp(e: PointerEvent) {
    if (!drag) return
    const clicked = !drag.moved
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    drag = null
    pressed.value = false
    if (!clicked) return
    editing.value = true
    text.value = display.value
    await nextTick()
    input.value?.select()
  }

  function commit() {
    // Enter and Escape unmount the input, which also fires blur; only the first one counts
    if (!editing.value) return
    editing.value = false
    const value = Number(text.value.trim())
    if (!text.value.trim() || !Number.isFinite(value)) mark(0, true)
    else set(value)
  }

  return { editing, pressed, invalid, text, display, fill, set, commit, onPointerDown, onPointerMove, onPointerUp }
}

/** A field made of parts (one per axis of a vector) reports `invalid` only when the field as a whole turns invalid or valid. */
export function useInvalidParts(emitInvalid: (invalid: boolean) => void) {
  const parts = reactive(new Set<number>())
  const invalid = computed(() => parts.size > 0)

  function mark(part: number, bad: boolean) {
    const before = parts.size > 0
    if (bad) parts.add(part)
    else parts.delete(part)
    if (before !== parts.size > 0) emitInvalid(!before)
  }

  return { invalid, mark }
}
