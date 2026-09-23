import { expect, it } from 'vitest'
import { readGraphFile, serializeGraphFile } from './file'
import { renderGraph } from '@/lib/graph/testing'
import sampleFile from '../../../../graphs/high-contrast-music.wledgraph?raw'

it('the sample .wledgraph file opens into a shader that compiles and renders, and survives another save', () => {
  const doc = readGraphFile(sampleFile).doc
  const first = renderGraph(doc, { leds: 8, time: 1 })
  expect(first.shader.error).toBeNull()
  expect(first.compileError, first.shader.code).toBeNull()
  // silence renders black: the graph is driven by audio, which a test frame does not have
  expect(first.leds).toHaveLength(8)

  const saved = readGraphFile(serializeGraphFile(doc)).doc
  expect(saved).toEqual(doc)
  expect(renderGraph(saved, { leds: 8, time: 1 }).shader.code).toBe(first.shader.code)
})
