import type { Category, CategoryId, ShaderNode } from './catalog'

export interface ReferenceCategory {
  id: CategoryId | null
  label: string
  color: string | null
  count: number
}

/** The entries whose name, title or description contain the query, ignoring case; a blank query matches every entry. */
export function matchNodes(nodes: readonly ShaderNode[], query: string): ShaderNode[] {
  const q = query.trim().toLowerCase()
  return nodes.filter((node) => !q || `${node.name} ${node.title} ${node.doc}`.toLowerCase().includes(q))
}

/** All, then every category that holds any entry at all, each counting the matched entries; a category stays listed while the search empties it. */
export function referenceCategories(categories: readonly Category[], nodes: readonly ShaderNode[], matched: readonly ShaderNode[]): ReferenceCategory[] {
  return [
    { id: null, label: 'All', color: null, count: matched.length },
    ...categories
      .filter((category) => nodes.some((node) => node.category === category.id))
      .map((category) => ({
        id: category.id,
        label: category.label,
        color: category.color,
        count: matched.filter((node) => node.category === category.id).length,
      })),
  ]
}

/** The categories with a match, narrowed to the selected one unless it is All, each with its matched entries. */
export function referenceSections(categories: readonly ReferenceCategory[], matched: readonly ShaderNode[], selected: CategoryId | null) {
  return categories
    .filter((row) => row.id !== null && row.count > 0 && (selected === null || row.id === selected))
    .map((row) => ({ ...row, nodes: matched.filter((node) => node.category === row.id) }))
}
