import { describe, expect, it } from 'vitest'
import type { MenuItem } from '@/lib/shader/menu-fs'
import type { NodeItem } from '@/lib/graph/define/shape'
import { GRAPH_FS } from './fs'

type Triple = [directory: string, entry: string, preset: string]

function walk(items: MenuItem<NodeItem>[], path: string): Triple[] {
  return items.flatMap((item): Triple[] => {
    if (item.type === 'directory') return walk(item.items, `${path}/${item.title}`)
    if (item.type === 'separator') return [[path, '---', '']]
    return [[path, item.node.id, item.preset?.title ?? '']]
  })
}

describe('GRAPH_FS', () => {
  // the menu is curated by hand; this pins its order and nesting so a refactor of how it is declared cannot move an entry
  it('lists the same entries in the same places', async () => {
    const triples = walk(GRAPH_FS.items, GRAPH_FS.title)
    await expect(triples.map((t) => JSON.stringify(t)).join('\n') + '\n').toMatchFileSnapshot('./__snapshots__/fs.menu.txt')
  })
})
