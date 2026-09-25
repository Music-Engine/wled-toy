import { computed, nextTick, ref, watch, type Ref } from 'vue'
import { flattenFs, type MenuEntry, type MenuFs, type MenuItem, type MenuPreset } from '@/lib/shader/menu-fs'

/**
 * The add-node menu's own state: which directory is shown, the search, the highlighted row and where the menu sits.
 * Opening it starts a fresh search in a directory the tree still has.
 */
export function useNodeMenu<T>(props: NodeMenuProps<T>, open: Ref<boolean>, focusSearch: () => void) {
  const query = ref('')
  const activeDirectory = ref('')
  const highlighted = ref(0)
  const hovered = ref<MenuEntry | null>(null)

  const directory = computed(() => props.fs.items.find((d) => d.title === activeDirectory.value) ?? props.fs.items[0])

  function directoryRows(items: MenuItem<T>[], path: string[], depth: number, rows: ListRow<T>[]): ListRow<T>[] {
    for (const item of items) {
      if (item.type === 'separator') rows.push({ kind: 'separator' })
      else if (item.type === 'node') rows.push({ kind: 'node', node: item.node, preset: item.preset, entry: props.describe(item.node, item.preset), path, depth, index: 0 })
      else {
        rows.push({ kind: 'directory', title: item.title, description: item.description, depth })
        directoryRows(item.items, [...path, item.title], depth + 1, rows)
      }
    }
    return rows
  }

  function searchRows(q: string): ListRow<T>[] {
    const rank = (entry: MenuEntry) => (entry.keywords.toLowerCase().startsWith(q) || entry.title.toLowerCase().startsWith(q) ? 0 : 1)
    return flattenFs(props.fs.items)
      .map(({ node, preset, path }): ListRow<T> => ({ kind: 'node', node, preset, entry: props.describe(node, preset), path, depth: 0, index: 0 }))
      .filter((row) => row.kind === 'node' && `${row.entry.keywords} ${row.entry.title} ${row.entry.description}`.toLowerCase().includes(q))
      .sort((a, b) => (a.kind === 'node' && b.kind === 'node' ? rank(a.entry) - rank(b.entry) : 0))
  }

  const rows = computed(() => {
    const q = query.value.trim().toLowerCase()
    const found = q ? searchRows(q) : directory.value ? directoryRows(directory.value.items, [directory.value.title], 0, []) : []
    let index = 0
    return found.map((row) => (row.kind === 'node' ? { ...row, index: index++ } : row))
  })

  const nodeRows = computed(() => rows.value.filter((row) => row.kind === 'node'))
  const preview = computed(() => hovered.value ?? nodeRows.value[highlighted.value]?.entry ?? null)

  // opened centered, the menu is a search palette: just the list, without the node preview
  const showPreview = computed(() => props.position !== null)

  const style = computed(() => {
    const width = showPreview.value ? 720 : 480
    const x = props.position?.x ?? (window.innerWidth - width) / 2
    const y = props.position?.y ?? window.innerHeight / 5
    return {
      left: `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`,
      top: `${Math.max(8, Math.min(y, window.innerHeight - MENU_HEIGHT - 8))}px`,
      width: `${width}px`,
      height: `${MENU_HEIGHT}px`,
    }
  })

  watch(rows, () => (highlighted.value = 0))
  watch(open, async (isOpen) => {
    if (!isOpen) return
    // a filtered tree (e.g. a dragged link) may not contain the last used directory
    activeDirectory.value = directory.value?.title ?? ''
    query.value = ''
    hovered.value = null
    highlighted.value = 0
    await nextTick()
    focusSearch()
  })

  return {
    query, activeDirectory, highlighted, hovered, directory, rows, nodeRows, preview, showPreview, style,
    /** Keyboard navigation: the next or previous node row, which also drops the hover preview. */
    step(delta: 1 | -1) {
      hovered.value = null
      highlighted.value = delta > 0 ? Math.min(nodeRows.value.length - 1, highlighted.value + 1) : Math.max(0, highlighted.value - 1)
    },
    moveDirectory(delta: number) {
      const directories = props.fs.items
      if (!directories.length) return
      const i = directories.findIndex((d) => d.title === directory.value?.title)
      activeDirectory.value = directories[(i + delta + directories.length) % directories.length].title
    },
  }
}

export interface NodeMenuProps<T> {
  position: { x: number; y: number } | null
  fs: MenuFs<T>
  describe: (node: T, preset?: MenuPreset) => MenuEntry
}

export type ListRow<T> =
  | { kind: 'node'; node: T; preset?: MenuPreset; entry: MenuEntry; path: string[]; index: number; depth: number }
  | { kind: 'directory'; title: string; description?: string; depth: number }
  | { kind: 'separator' }

const MENU_HEIGHT = 440
