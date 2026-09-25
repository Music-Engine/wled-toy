<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

interface Option { value: string; label: string; group?: string }
interface Column { heading: string; items: { option: Option; index: number }[] }

const props = defineProps<{ modelValue: string; options: readonly Option[]; label?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const root = ref<HTMLElement>()
const menu = ref<HTMLElement>()
const open = ref(false)
const active = ref(0)
const place = ref<{ left: string; top: string } | null>(null)
const selected = computed(() => props.options.find((o) => o.value === props.modelValue))

// Blender's enum popup: everything visible at once, one column per group, or even columns of at most 12 once a plain list passes 8
const columns = computed<Column[]>(() => {
  const items = props.options.map((option, index) => ({ option, index }))
  if (items.some((item) => item.option.group)) {
    const byGroup = new Map<string, Column>()
    for (const item of items) {
      const heading = item.option.group ?? ''
      if (!byGroup.has(heading)) byGroup.set(heading, { heading, items: [] })
      byGroup.get(heading)!.items.push(item)
    }
    return [...byGroup.values()]
  }
  const count = items.length <= 8 ? 1 : Math.ceil(items.length / 12)
  const rows = Math.ceil(items.length / count)
  return Array.from({ length: count }, (_, c) => ({ heading: '', items: items.slice(c * rows, (c + 1) * rows) }))
})

function choose(value: string) {
  emit('update:modelValue', value)
  open.value = false
}

function move(key: string) {
  const column = columns.value.findIndex((c) => c.items.some((item) => item.index === active.value))
  const row = columns.value[column].items.findIndex((item) => item.index === active.value)
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    // in reading order, which is not the options' order once groups gather them: the end of a column leads into the next
    const order = columns.value.flatMap((c) => c.items.map((item) => item.index))
    active.value = order[Math.min(order.length - 1, Math.max(0, order.indexOf(active.value) + (key === 'ArrowDown' ? 1 : -1)))]
  } else {
    const target = columns.value[column + (key === 'ArrowRight' ? 1 : -1)]
    if (target) active.value = target.items[Math.min(row, target.items.length - 1)].index
  }
}

let typed = ''
let typedAt = 0
function jumpTo(key: string) {
  const now = performance.now()
  typed = (now - typedAt > 700 ? '' : typed) + key.toLowerCase()
  typedAt = now
  const match = props.options.findIndex((o) => o.label.toLowerCase().startsWith(typed))
  if (match >= 0) active.value = match
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value) {
    if (['Enter', ' ', 'ArrowDown'].includes(e.key)) {
      e.preventDefault()
      open.value = true
    }
    return
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return
  e.preventDefault()
  if (e.key === 'Escape') open.value = false
  else if (e.key.startsWith('Arrow')) move(e.key)
  // a space continues a word being typed ("less t"), and selects otherwise
  else if (e.key === 'Enter' || (e.key === ' ' && performance.now() - typedAt > 700)) choose(props.options[active.value].value)
  else if (e.key.length === 1) jumpTo(e.key)
}

const closeOnOutside = (e: Event) => {
  if (!root.value?.contains(e.target as Node) && !menu.value?.contains(e.target as Node)) open.value = false
}
const close = () => (open.value = false)

// the popup lives on <body>, so the canvas moving under it (a wheel zoom, a resize) would leave it behind
function listen(on: boolean) {
  const method = on ? 'addEventListener' : 'removeEventListener'
  document[method]('pointerdown', closeOnOutside, true)
  document[method]('wheel', closeOnOutside, true)
  window[method]('resize', close)
}

watch(open, async (isOpen) => {
  listen(isOpen)
  place.value = null
  if (!isOpen) return
  typed = ''
  active.value = Math.max(0, props.options.findIndex((o) => o.value === props.modelValue))
  await nextTick()
  if (!root.value || !menu.value) return
  const button = root.value.getBoundingClientRect()
  const size = menu.value.getBoundingClientRect()
  const below = button.bottom + 2 + size.height <= window.innerHeight - 8
  const top = below ? button.bottom + 2 : Math.max(8, button.top - 2 - size.height)
  place.value = {
    left: `${Math.max(8, Math.min(button.left, window.innerWidth - 8 - size.width))}px`,
    top: `${Math.min(top, Math.max(8, window.innerHeight - 8 - size.height))}px`,
  }
})
onBeforeUnmount(() => listen(false))
</script>

<template>
  <div ref="root" class="nui-dropdown nodrag nowheel" :class="{ 'is-open': open }" @keydown="onKeydown">
    <button type="button" class="nui-dropdown-button" role="combobox" :aria-expanded="open" :aria-label="label" @click="open = !open">
      <span class="nui-label">{{ selected?.label ?? modelValue }}</span>
      <svg viewBox="0 0 10 10"><path d="M2 3.5l3 3 3-3" /></svg>
    </button>
    <!-- on <body>: inside the node it would be clipped by the canvas, scaled by its zoom and covered by the next node. Like Blender's popups it keeps interface size at any zoom. -->
    <Teleport to="body">
      <div v-if="open" ref="menu" class="nui nui-dropdown-menu" :style="place ?? { visibility: 'hidden' }" role="listbox" :aria-label="label">
        <div v-if="label" class="nui-dropdown-title">{{ label }}</div>
        <div class="nui-dropdown-columns">
          <div v-for="column in columns" :key="column.heading" class="nui-dropdown-column" role="group" :aria-label="column.heading || undefined">
            <div v-if="column.heading" class="nui-dropdown-heading">{{ column.heading }}</div>
            <div
              v-for="{ option, index } in column.items"
              :key="option.value"
              class="nui-dropdown-option"
              :class="{ 'is-selected': option.value === modelValue, 'is-active': index === active && option.value !== modelValue }"
              role="option"
              :aria-selected="option.value === modelValue"
              @pointerenter="active = index"
              @click="choose(option.value)"
            >
              {{ option.label }}
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
