import { describe, expect, it } from 'vitest'
import type { Category, ShaderNode } from './catalog'
import { matchNodes, referenceCategories, referenceSections } from './reference-search'

const node = (name: string, category: ShaderNode['category'], title: string, doc: string) => ({ name, category, title, doc }) as ShaderNode
const NODES = [
  node('sawWave', 'signal', 'Saw Wave', 'A ramp.'),
  node('bass', 'audio', 'Bass', 'Low band level.'),
  node('iAudio', 'audio', 'Audio Texture', 'Spectrum and wave.'),
]
const CATEGORIES: Category[] = [
  { id: 'signal', label: 'Signal', icon: '', color: 'red' },
  { id: 'audio', label: 'Audio', icon: '', color: 'blue' },
  { id: 'noise', label: 'Noise', icon: '', color: 'green' },
]

describe('matchNodes', () => {
  it('a blank query matches every entry', () => {
    expect(matchNodes(NODES, '  ')).toEqual(NODES)
  })

  it('matches name, title and description, ignoring case and surrounding space', () => {
    expect(matchNodes(NODES, ' WAVE ').map((n) => n.name)).toEqual(['sawWave', 'iAudio'])
    expect(matchNodes(NODES, 'low band').map((n) => n.name)).toEqual(['bass'])
    expect(matchNodes(NODES, 'nothing')).toEqual([])
  })
})

describe('referenceCategories', () => {
  it('lists All, then only categories that hold entries, counting the matched ones', () => {
    const rows = referenceCategories(CATEGORIES, NODES, matchNodes(NODES, 'wave'))
    expect(rows.map((r) => [r.id, r.label, r.count])).toEqual([
      [null, 'All', 2],
      ['signal', 'Signal', 1],
      ['audio', 'Audio', 1],
    ])
  })

  it('keeps a category the search empties, at a count of zero', () => {
    expect(referenceCategories(CATEGORIES, NODES, matchNodes(NODES, 'bass')).map((r) => r.count)).toEqual([1, 0, 1])
  })
})

describe('referenceSections', () => {
  const matched = matchNodes(NODES, 'wave')
  const rows = referenceCategories(CATEGORIES, NODES, matched)

  it('All shows every category with a match, each with its entries', () => {
    expect(referenceSections(rows, matched, null).map((s) => [s.id, s.nodes.map((n) => n.name)])).toEqual([
      ['signal', ['sawWave']],
      ['audio', ['iAudio']],
    ])
  })

  it('a selected category narrows to itself, and to nothing when it has no match', () => {
    expect(referenceSections(rows, matched, 'audio').map((s) => s.id)).toEqual(['audio'])
    expect(referenceSections(referenceCategories(CATEGORIES, NODES, matchNodes(NODES, 'bass')), matchNodes(NODES, 'bass'), 'signal')).toEqual([])
  })
})
