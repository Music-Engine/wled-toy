import { beforeEach, describe, expect, it } from 'vitest'
import { applyDrop, classifyFile, dragHint, isConfigExport, isGraphEnvelope, planDrop, type DropTargets } from './file-drop'
import { logs } from '@/lib/app/logs'
import { launchScreen } from '@/lib/app/settings/preferences'
import type { Mode } from '@/lib/app/workspace'

const file = (name: string, type = '') => ({ name, type })

describe('classifyFile', () => {
  it('takes the media type when the name says nothing', () => {
    expect(classifyFile(file('recording', 'audio/mpeg'))).toBe('audio')
    expect(classifyFile(file('photo', 'image/heic'))).toBe('image')
    expect(classifyFile(file('export', 'application/json'))).toBe('config')
  })

  it('takes the extension when the browser gives no type, whatever its case', () => {
    expect(['a.mp3', 'a.wav', 'a.ogg', 'a.oga', 'a.opus', 'a.flac', 'a.m4a', 'a.aac', 'a.webm'].map((name) => classifyFile(file(name)))).toEqual(Array(9).fill('audio'))
    expect(['a.png', 'a.jpg', 'a.jpeg', 'a.webp', 'a.gif', 'a.bmp', 'a.svg'].map((name) => classifyFile(file(name)))).toEqual(Array(7).fill('image'))
    expect(['a.glsl', 'a.frag', 'a.fs'].map((name) => classifyFile(file(name)))).toEqual(['shader', 'shader', 'shader'])
    expect(classifyFile(file('Aurora.WLEDGRAPH'))).toBe('graph')
    expect(classifyFile(file('wledtoy-1.json'))).toBe('config')
  })

  it('lets the extension win over a type that misleads', () => {
    expect(classifyFile(file('loop.webm', 'video/webm'))).toBe('audio')
    expect(classifyFile(file('aurora.wledgraph', 'application/json'))).toBe('graph')
    expect(classifyFile(file('wave.frag', 'text/plain'))).toBe('shader')
  })

  it('knows nothing about the rest', () => {
    expect(classifyFile(file('notes.txt', 'text/plain'))).toBe('unknown')
    expect(classifyFile(file('clip.mp4', 'video/mp4'))).toBe('unknown')
    expect(classifyFile(file('Makefile'))).toBe('unknown')
    expect(classifyFile(file('archive.tar.gz', 'application/gzip'))).toBe('unknown')
  })
})

describe('planDrop', () => {
  it('runs settings and media first and documents last, the graph after the shader', () => {
    const plan = planDrop([file('a.wledgraph'), file('b.glsl'), file('c.png'), file('d.mp3'), file('e.json')])
    expect(plan.steps.map((step) => [step.kind, step.file.name])).toEqual([['config', 'e.json'], ['audio', 'd.mp3'], ['image', 'c.png'], ['shader', 'b.glsl'], ['graph', 'a.wledgraph']])
    expect(plan.skipped).toEqual([])
    expect(plan.unknown).toEqual([])
  })

  it('takes the first file of a kind and skips the others', () => {
    const plan = planDrop([file('one.wledgraph'), file('two.wledgraph'), file('a.glsl'), file('b.frag'), file('x.png'), file('y.jpg')])
    expect(plan.steps.map((step) => step.file.name)).toEqual(['x.png', 'a.glsl', 'one.wledgraph'])
    expect(plan.skipped.map((skipped) => skipped.name)).toEqual(['two.wledgraph', 'b.frag', 'y.jpg'])
  })

  it('sets unknown files apart and does nothing with them', () => {
    const plan = planDrop([file('notes.txt', 'text/plain'), file('song.flac')])
    expect(plan.steps.map((step) => step.kind)).toEqual(['audio'])
    expect(plan.unknown.map((unknown) => unknown.name)).toEqual(['notes.txt'])
  })

  it('has nothing to do for an empty drop', () => {
    expect(planDrop([])).toEqual({ steps: [], skipped: [], unknown: [] })
  })
})

describe('dragHint', () => {
  it('names what a conclusive type will do, by mode for an image', () => {
    expect(dragHint(['audio/wav'], 'shader')).toBe('Drop to use as the audio track')
    expect(dragHint(['image/png'], 'graph')).toBe('Drop to add an Image Texture here')
    expect(dragHint(['image/png'], 'shader')).toBe('Drop to use as the image texture')
    expect(dragHint(['image/png'], 'reference')).toBe('Drop to use as the image texture')
    expect(dragHint(['application/json'], 'graph')).toBe('Drop to import settings')
    expect(dragHint(['video/mp4'], 'graph')).toBe('This file type is not supported')
  })

  it('stays neutral when the type is empty or could be a shader or a graph', () => {
    expect(dragHint([''], 'graph')).toBe('Drop file')
    expect(dragHint(['text/plain'], 'graph')).toBe('Drop file')
    expect(dragHint(['application/octet-stream'], 'graph')).toBe('Drop file')
    expect(dragHint([], 'graph')).toBe('Drop file')
  })

  it('stays neutral for a mixed drag and speaks for several files of one kind', () => {
    expect(dragHint(['audio/wav', 'image/png'], 'graph')).toBe('Drop files')
    expect(dragHint(['image/png', ''], 'graph')).toBe('Drop files')
    expect(dragHint(['image/png', 'image/jpeg'], 'graph')).toBe('Drop to add an Image Texture here')
  })
})

describe('isGraphEnvelope', () => {
  it('knows a saved graph by its envelope, not by its file name', () => {
    expect(isGraphEnvelope({ app: 'wledtoy', formatVersion: 1, graph: { nodes: [], edges: [] } })).toBe(true)
    expect(isGraphEnvelope({ app: 'wledtoy', version: 3, fps: 30 })).toBe(false)
    expect(isGraphEnvelope({ app: 'other', formatVersion: 1, graph: {} })).toBe(false)
    expect(isGraphEnvelope(null)).toBe(false)
  })
})

describe('isConfigExport', () => {
  it('is an object this app exported, and not a graph file', () => {
    expect(isConfigExport({ app: 'wledtoy', version: 3, fps: 30 })).toBe(true)
    expect(isConfigExport({ app: 'wledtoy', formatVersion: 1, graph: {} })).toBe(false)
    expect(isConfigExport({ name: 'package' })).toBe(false)
    expect(isConfigExport([1, 2])).toBe(false)
    expect(isConfigExport(null)).toBe(false)
  })
})

describe('applyDrop', () => {
  let calls: unknown[][]
  const at = { x: 10, y: 20 }
  const targets = (mode: Mode, overrides: Partial<DropTargets> = {}): DropTargets => ({
    mode: () => mode,
    openPage: async (page) => ({ openFile: async (opened) => { calls.push(['openFile', page, opened]) } }),
    imageDrop: async () => (...args) => { calls.push(['addNode', ...args]) },
    useImage: async (image) => { calls.push(['useImage', image.name]) },
    addImage: async (_, name) => ({ id: 'img-1', name }),
    useSong: async (song) => { calls.push(['useSong', song.name]); return true },
    playFromFile: async () => { calls.push(['playFromFile']) },
    importData: (raw) => { calls.push(['importData', raw]); return { fps: 60 } },
    ...overrides,
  })
  const drop = (files: File[], dropTargets: DropTargets) => applyDrop(planDrop(files), at, dropTargets)

  beforeEach(() => {
    calls = []
    logs.value = []
    launchScreen.open = true
  })

  it('sends each kind of file to its operation and closes the launch screen', async () => {
    const settings = { app: 'wledtoy', fps: 60 }
    await drop([new File(['void main(){}'], 'a.glsl'), new File(['{}'], 'b.wledgraph'), new File([''], 'c.mp3'), new File([''], 'd.png'), new File([JSON.stringify(settings)], 'e.json')], targets('shader'))
    expect(calls).toEqual([
      ['importData', settings],
      ['useSong', 'c.mp3'],
      ['playFromFile'],
      ['useImage', 'd.png'],
      ['openFile', 'shader', { name: 'a.glsl', text: 'void main(){}' }],
      ['openFile', 'graph', { name: 'b.wledgraph', text: '{}' }],
    ])
    expect(launchScreen.open).toBe(false)
  })

  it('adds an image as a node at the drop point in graph mode', async () => {
    await drop([new File([''], 'd.png')], targets('graph'))
    expect(calls).toEqual([['addNode', 'img-1', 'd.png', at]])
  })

  it('opens a settings file that holds a graph as a graph', async () => {
    const text = JSON.stringify({ app: 'wledtoy', formatVersion: 1, graph: {} })
    await drop([new File([text], 'renamed.json')], targets('shader'))
    expect(calls).toEqual([['openFile', 'graph', { name: 'renamed.json', text }]])
  })

  it('does not start a track the engine refused', async () => {
    await drop([new File([''], 'c.mp3')], targets('shader', { useSong: async () => false }))
    expect(calls).toEqual([])
  })

  it('reports a failed open and still runs the steps after it', async () => {
    const openPage: DropTargets['openPage'] = async (page) => {
      if (page === 'shader') throw new Error('route refused')
      return { openFile: async (opened) => { calls.push(['openFile', page, opened.name]) } }
    }
    await expect(drop([new File([''], 'a.glsl'), new File([''], 'b.wledgraph')], targets('shader', { openPage }))).resolves.toBeUndefined()
    expect(logs.value.map((entry) => [entry.level, entry.message])).toEqual([['error', 'a.glsl could not be used: route refused']])
    expect(calls).toEqual([['openFile', 'graph', 'b.wledgraph']])
  })

  it('warns about a file it does not take and leaves the launch screen open', async () => {
    await drop([new File([''], 'notes.txt')], targets('shader'))
    expect(logs.value.map((entry) => entry.level)).toEqual(['warn'])
    expect(launchScreen.open).toBe(true)
  })
})
