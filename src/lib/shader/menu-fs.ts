/** A menu laid out like a small filesystem: directories hold nodes, separators and other directories. */
export interface MenuDirectory<T> {
  type: 'directory'
  title: string
  description?: string
  icon?: string
  color?: string
  items: MenuItem<T>[]
}

/** A node to add. With a `preset` it is the node started with those values, listed and searched under its own title. */
export interface MenuNode<T> {
  type: 'node'
  node: T
  preset?: MenuPreset
}

export interface MenuPreset {
  title: string
  values: Record<string, unknown>
}

export interface MenuSeparator {
  type: 'separator'
}

export type MenuItem<T> = MenuDirectory<T> | MenuNode<T> | MenuSeparator

export interface MenuFs<T> {
  title: string
  items: MenuDirectory<T>[]
}

/** What a menu needs to list and preview a node, whatever the node is underneath. */
export interface MenuEntry {
  id: string
  title: string
  description: string
  signature: string
  /** Extra text the search matches besides title and description. */
  keywords: string
  /** Where the entry sits in the menu when it is a preset of another node, e.g. "Math". */
  of?: string
  color: string
  icon: string
  inputs: { label: string; type: string; color: string }[]
  outputs: { label: string; color: string }[]
  note?: string
}

export interface MenuRow<T> {
  node: T
  preset?: MenuPreset
  /** Titles of the directories leading to the node. */
  path: string[]
}

export const directory = <T>(
  title: string,
  items: MenuItem<T>[],
  options: Pick<MenuDirectory<T>, 'description' | 'icon' | 'color'> = {},
): MenuDirectory<T> => ({ type: 'directory', title, items, ...options })
export const leaf = <T>(node: T, preset?: MenuPreset): MenuNode<T> => ({ type: 'node', node, ...(preset && { preset }) })
export const separator: MenuSeparator = { type: 'separator' }

export function flattenFs<T>(items: MenuItem<T>[], path: string[] = []): MenuRow<T>[] {
  return items.flatMap((item) => {
    if (item.type === 'node') return [{ node: item.node, preset: item.preset, path }]
    if (item.type === 'directory') return flattenFs(item.items, [...path, item.title])
    return []
  })
}

function filterItems<T>(items: MenuItem<T>[], keep: (node: T) => boolean): MenuItem<T>[] {
  const kept = items.flatMap((item): MenuItem<T>[] => {
    if (item.type === 'node') return keep(item.node) ? [item] : []
    if (item.type === 'separator') return [item]
    const inner = filterItems(item.items, keep)
    return inner.length ? [{ ...item, items: inner }] : []
  })
  // a separator only makes sense between two things
  return kept.filter((item, i) => item.type !== 'separator' || (i > 0 && i < kept.length - 1 && kept[i - 1].type !== 'separator'))
}

/** The same tree with only the nodes `keep` accepts; directories left empty are dropped. */
export function filterFs<T>(fs: MenuFs<T>, keep: (node: T) => boolean): MenuFs<T> {
  return { ...fs, items: filterItems(fs.items, keep) as MenuDirectory<T>[] }
}
