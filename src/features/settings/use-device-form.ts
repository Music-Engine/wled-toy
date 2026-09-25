import { computed, reactive, ref, watch } from 'vue'
import { activeDevice, addDevice, devices, duplicateDevice, removeDevice, updateDevice, type SavedDevice } from '@/lib/app/devices'
import { useEngine } from '@/lib/engine/engine'
import { EngineError } from '@/lib/engine/engine-error'
import { layoutCount, layoutKind, layoutSummary, onlySegment, parseLayout, parseLayoutJson, presetLayout, type Layout, type LayoutKind, type Segment } from '@/lib/engine/layout'

/** The device the settings form edits, its inline field errors, and the connection line of the active device. */
export function useDeviceForm() {
  const { stats } = useEngine().bridge

  const selectedId = ref(activeDevice.value.id)
  const device = computed(() => devices.value.find((d) => d.id === selectedId.value) ?? activeDevice.value)
  const isActive = computed(() => device.value.id === activeDevice.value.id)

  const errors = reactive<Record<string, string | null>>({})
  const customOpen = ref(false)
  const customJson = ref('')

  const only = computed(() => onlySegment(device.value.layout))
  const kind = computed<LayoutKind>(() => (customOpen.value ? 'custom' : layoutKind(device.value.layout)))
  const ring = computed(() => (only.value?.kind === 'ring' ? only.value : null))
  const matrix = computed(() => (only.value?.kind === 'matrix' ? only.value : null))
  const summary = computed(() => layoutSummary(device.value.layout))

  watch(() => device.value.id, () => {
    for (const key of Object.keys(errors)) errors[key] = null
    customOpen.value = false
  }, { flush: 'sync' })

  const patch = (fields: Partial<Omit<SavedDevice, 'id'>>) => updateDevice(device.value.id, fields)

  function setLayout(layout: Layout | null): boolean {
    if (layout && !parseLayout(layout)) {
      errors.layout = 'A layout needs at least 1 and at most 4096 LEDs.'
      return false
    }
    errors.layout = null
    patch({ layout, ledCount: layout ? layoutCount(layout) : device.value.ledCount })
    return true
  }

  function setKind(next: LayoutKind) {
    customOpen.value = next === 'custom'
    if (next === 'custom') customJson.value = device.value.layout ? JSON.stringify(device.value.layout, null, 2) : ''
    else setLayout(presetLayout(next, device.value.ledCount))
  }

  const setSegment = (fields: Partial<Segment>) => setLayout({ segments: [{ ...only.value!, ...fields } as Segment] })

  function setLedCount(count: number) {
    if (ring.value) setSegment({ count })
    else patch({ ledCount: count })
  }

  function commitCustom() {
    let layout: Layout
    try {
      layout = parseLayoutJson(customJson.value)
    } catch (e) {
      if (!(e instanceof EngineError)) throw e
      errors.custom = e.message
      return
    }
    errors.custom = null
    setLayout(layout)
  }

  function add() {
    selectedId.value = addDevice().id
  }

  function duplicate() {
    const copy = duplicateDevice(device.value.id)
    if (copy) selectedId.value = copy.id
  }

  function remove() {
    const index = devices.value.findIndex((d) => d.id === device.value.id)
    removeDevice(device.value.id)
    selectedId.value = devices.value[Math.max(0, index - 1)].id
  }

  const connection = computed(() => {
    if (stats.status !== 'connected') return { dot: 'bg-error', text: stats.status === 'connecting' ? 'Connecting to the bridge...' : 'The bridge is offline, so frames cannot reach any device.' }
    if (!device.value.host) return { dot: 'bg-warning', text: 'No host set. Frames are rendered but not sent.' }
    if (!stats.device) return { dot: 'bg-(--ui-text-dimmed)', text: `No reply from ${device.value.host} yet. Art-Net and sACN receivers other than WLED never reply.` }
    const ping = stats.deviceMs == null ? '' : ` in ${Math.round(stats.deviceMs)} ms`
    return { dot: 'bg-success', text: `${stats.device.name} ${stats.device.version} answered${ping} and reports ${stats.device.ledCount} LEDs.` }
  })
  const reportedCount = computed(() => (isActive.value && stats.device && !device.value.layout && stats.device.ledCount !== device.value.ledCount ? stats.device.ledCount : null))

  return { selectedId, device, isActive, errors, customJson, layoutKind: kind, layoutSummary: summary, ring, matrix, patch, setKind, setSegment, setLedCount, commitCustom, add, duplicate, remove, connection, reportedCount }
}
