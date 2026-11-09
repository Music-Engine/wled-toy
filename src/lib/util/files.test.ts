import { describe, expect, it } from 'vitest'
import { baseName, extension } from './files'

describe('extension', () => {
  it('is the lowercased text after the last dot, or empty without one', () => {
    expect(extension('Song.MP3')).toBe('mp3')
    expect(extension('scene.graph.wledgraph')).toBe('wledgraph')
    expect(extension('README')).toBe('')
    expect(extension('trailing.')).toBe('')
  })
})

describe('baseName', () => {
  it('takes the last segment of a posix or windows path', () => {
    expect(baseName('/Users/me/show.wledgraph')).toBe('show.wledgraph')
    expect(baseName('C:\\shows\\show.wledgraph')).toBe('show.wledgraph')
    expect(baseName('plain.glsl')).toBe('plain.glsl')
  })
})
