import { computed, nextTick, onActivated, ref, watch } from 'vue'
import { copyText } from '@/lib/app/clipboard'
import { CATEGORIES, NODES, nodeByName, type ShaderNode } from '@/lib/shader/glsl'
import { matchNodes, referenceCategories, referenceSections } from '@/lib/shader/reference-search'

/** The reference page's search, category filter, the entry scrolled to, and keyboard movement and copying in the entry list. */
export function useReferenceSearch() {
  const query = ref('')
  const categoryIndex = ref(0)
  const copied = ref<string | null>(null)
  const search = ref<HTMLInputElement>()
  const entryList = ref<HTMLElement>()
  const activeEntry = ref<string | null>(null)

  const matchedNodes = computed(() => matchNodes(NODES, query.value))
  const categories = computed(() => referenceCategories(CATEGORIES, NODES, matchedNodes.value))
  const sections = computed(() => referenceSections(categories.value, matchedNodes.value, categories.value[categoryIndex.value]?.id ?? null))

  const entryElements = () => [...(entryList.value?.querySelectorAll<HTMLElement>('[data-entry]') ?? [])]

  function trackActiveEntry() {
    const list = entryList.value
    if (!list) return
    const top = list.getBoundingClientRect().top + 36
    activeEntry.value = entryElements().find((el) => el.getBoundingClientRect().bottom > top)?.dataset.entry ?? null
  }

  watch([query, categoryIndex], async () => {
    await nextTick()
    entryList.value?.scrollTo({ top: 0 })
    trackActiveEntry()
  })

  function jumpTo(name: string) {
    const el = entryElements().find((entry) => entry.dataset.entry === name)
    el?.scrollIntoView({ block: 'start' })
    el?.focus({ preventScroll: true })
  }

  function onEntryKeydown(e: KeyboardEvent, node: ShaderNode) {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter') return void copy(node)
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const rows = entryElements()
    rows[rows.indexOf(e.currentTarget as HTMLElement) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus()
  }

  async function copy(node: ShaderNode) {
    await copyText(node.kind === 'function' ? node.signature : node.snippet.replace(/\$\{([^}]*)\}/g, '$1'))
    copied.value = node.name
    setTimeout(() => copied.value === node.name && (copied.value = null), 1200)
  }

  function copyFocused() {
    const name = (document.activeElement as HTMLElement | null)?.dataset.entry
    const node = name ? nodeByName.get(name) : undefined
    if (node) void copy(node)
  }

  function focusSearch() {
    search.value?.focus()
    search.value?.select()
  }

  onActivated(trackActiveEntry)

  return { query, categoryIndex, copied, search, entryList, activeEntry, matchedNodes, categories, sections, trackActiveEntry, jumpTo, onEntryKeydown, copy, copyFocused, focusSearch }
}
