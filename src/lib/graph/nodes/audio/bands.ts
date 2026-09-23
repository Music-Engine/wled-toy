import type { Features } from '@/lib/audio/dsp'
import { defineNode } from '@/lib/graph/define/define'
import type { FrameInfo } from '@/lib/graph/define/context'
import { Enum, Float, SpectrumStream } from '@/lib/graph/define/socket-types'

const COUNTS = [{ value: '4', label: '4 bands' }, { value: '8', label: '8 bands' }, { value: '16', label: '16 bands' }] as const

/** A few band levels as per-frame numbers; the count decides how many outputs the node has. */
export const bandsNode = defineNode('bands', ({ count = '8' }: { count?: string }) => {
  const n = Number(count) || 8
  return {
    title: 'Bands',
    description: 'The spectrum folded into a few bands, each an output you can wire per frame: the per-frame side of the Spectrum node.',
    category: 'audio',
    input: { spectrum: SpectrumStream, count: { type: Enum(COUNTS), label: '', default: '8', connectable: false, props: { label: 'Bands' } } },
    output: Object.fromEntries(Array.from({ length: n }, (_, i) => [`band${i + 1}`, { type: Float, label: `Band ${i + 1}` }])),
    run: ({ spectrum }, _, frame: FrameInfo) => {
      const f: Features | null | undefined = frame.audio?.analyses[spectrum?.slot ?? 0]
      const bands = f?.bands
      return Object.fromEntries(Array.from({ length: n }, (_, i) => {
        if (!bands) return [`band${i + 1}`, 0]
        // each output is the loudest of the analysis bands it covers
        const from = Math.floor((i * bands.length) / n)
        const to = Math.max(from + 1, Math.floor(((i + 1) * bands.length) / n))
        let peak = 0
        for (let k = from; k < to; k++) peak = Math.max(peak, bands[k])
        return [`band${i + 1}`, peak]
      }))
    },
  }
})
