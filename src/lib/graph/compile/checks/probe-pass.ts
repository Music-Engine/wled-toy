import type { Check } from '@/lib/graph/compile/context'

/** Probe fed per pixel has no frame value; program runs w/o it */
export const checkProbePass = (): Check => ({
  name: 'checkProbePass',
  reads: ['pass'],
  withholds: false,
  check: (ctx) =>
    ctx.order
      .filter((id) => ctx.nodes[id].shape.probe && ctx.nodes[id].pass === 'pixel')
      .map((id) => ({ nodeId: id, message: `${ctx.nodes[id].shape.title} is read back once per frame, so it cannot take a value that changes per pixel` })),
})
