import { expect, it } from 'vitest'
import { createGlslCompiler } from '@/lib/graph'
import { tickGraph } from '@/lib/graph/testing'
import sampleFile from '/graphs/high-contrast-music.wledgraph?raw'
import { readGraphFile, serializeGraphFile } from './file'

it('the sample .wledgraph file opens into a program that compiles and renders, and survives another save', () => {
  const doc = readGraphFile(sampleFile).doc
  const first = createGlslCompiler().compile(doc)
  expect(first.issues).toEqual([])
  // Audio-driven, so silence renders black; frame 30 is at 1 s
  expect(tickGraph(doc, { leds: 8, frames: 31 })[30]).toHaveLength(8)

  const saved = readGraphFile(serializeGraphFile(doc)).doc
  expect(saved).toEqual(doc)
  expect(createGlslCompiler().compile(saved).program).toEqual(first.program)
})
