import { defineNode, Enum, Float, SpectrumStream } from '@/lib/graph/authoring'
import { audioReadsChunk } from '@/lib/graph/nodes/glsl/audio'

const COUNTS = [{ value: '4', label: '4 bands' }, { value: '8', label: '8 bands' }, { value: '16', label: '16 bands' }] as const

/** Count decides the outputs */
export const bandsNode = defineNode('bands', ({ count = '8' }: { count?: string }) => {
  const bandCount = Number(count) || 8
  return {
    title: 'Bands',
    description: 'The spectrum folded into a few bands, each an output you can wire per frame: the per-frame side of the Spectrum node.',
    category: 'audio',
    prefers: 'frame',
    input: { spectrum: SpectrumStream, count: { type: Enum(COUNTS), label: '', default: '8', linkable: false, props: { label: 'Bands' } } },
    output: Object.fromEntries(Array.from({ length: bandCount }, (_, i) => [`band${i + 1}`, { type: Float, label: `Band ${i + 1}` }])),
    body: ({ spectrum }, ctx) => {
      ctx.include(audioReadsChunk)
      return Object.fromEntries(Array.from({ length: bandCount }, (_, i) => [`band${i + 1}`, ctx.declare('float', `bandsPeak(${spectrum?.slot ?? 0}, ${i}, ${bandCount})`, `band${i + 1}`)]))
    },
  }
})
