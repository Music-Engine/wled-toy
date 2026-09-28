import { describe, expect, it } from 'vitest'
import { directory, filterFs, flattenFs, leaf, separator, type MenuFs } from './menu-fs'

const fs: MenuFs<string> = {
  title: 'Add',
  items: [directory('A', [leaf('a1'), separator, directory('Inner', [leaf('a2')]), separator, leaf('a3')]), directory('B', [leaf('b1')])],
}

describe('flattenFs', () => {
  it('lists nodes depth first with their directory path', () => {
    expect(flattenFs(fs.items)).toEqual([
      { node: 'a1', path: ['A'] },
      { node: 'a2', path: ['A', 'Inner'] },
      { node: 'a3', path: ['A'] },
      { node: 'b1', path: ['B'] },
    ])
  })
})

describe('filterFs', () => {
  it('drops empty directories and separators left dangling or doubled', () => {
    const kept = filterFs(fs, (n) => n === 'a1' || n === 'a3')
    expect(kept.items.map((d) => d.title)).toEqual(['A'])
    expect(kept.items[0].items.map((i) => i.type)).toEqual(['node', 'separator', 'node'])
    expect(filterFs(fs, (n) => n === 'a2').items[0].items.map((i) => i.type)).toEqual(['directory'])
  })
})
